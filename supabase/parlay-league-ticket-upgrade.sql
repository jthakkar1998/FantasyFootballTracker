-- Week 11+ league ticket / early kickoff upgrade. Run in Supabase SQL Editor
-- BEFORE deploying the associated application code. Existing rows remain intact.
BEGIN;

ALTER TABLE public.parlay_line_snapshots
  DROP CONSTRAINT IF EXISTS parlay_line_snapshots_snapshot_slot_check;
ALTER TABLE public.parlay_line_snapshots ADD CONSTRAINT parlay_line_snapshots_snapshot_slot_check
  CHECK (snapshot_slot IN ('early', 'submission', 'backup', 'primary'));
ALTER TABLE public.parlay_snapshot_runs
  DROP CONSTRAINT IF EXISTS parlay_snapshot_runs_slot_check;
ALTER TABLE public.parlay_snapshot_runs ADD CONSTRAINT parlay_snapshot_runs_slot_check
  CHECK (slot IN ('early', 'backup', 'primary'));

-- One immutable, confirmed, structured off-app leg per fantasy team/week.
-- Historical free-text records are NOT auto-imported or treated as verified.
CREATE TABLE IF NOT EXISTS public.parlay_offapp_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL, week integer NOT NULL CHECK (week BETWEEN 1 AND 22),
  team_id integer NOT NULL, team_name text NOT NULL,
  espn_player_id integer NOT NULL, pro_team_id integer NOT NULL,
  player_name text NOT NULL, nfl_event_id text NOT NULL, event_starts_at timestamptz NOT NULL,
  stat_id text NOT NULL, side_id text NOT NULL CHECK (side_id IN ('over','under','yes','no')),
  line text, book_name text NOT NULL, notes text,
  confirmed boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, week, team_id)
);
ALTER TABLE public.parlay_offapp_legs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parlay_offapp_legs FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS parlay_offapp_legs_week_idx ON public.parlay_offapp_legs(season, week);

CREATE TABLE IF NOT EXISTS public.parlay_ticket_state (
  season integer NOT NULL, week integer NOT NULL CHECK (week BETWEEN 1 AND 22),
  status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead')),
  dead_alert_key text, dead_reason text, dead_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(season, week)
);
ALTER TABLE public.parlay_ticket_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parlay_ticket_state FROM anon, authenticated;

-- New log for LEAGUE BROADCASTS. Keep prior individual alert log untouched.
CREATE TABLE IF NOT EXISTS public.parlay_ticket_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL, week integer NOT NULL CHECK (week BETWEEN 1 AND 22),
  alert_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('hit','dead')),
  source_team_id integer NOT NULL,
  subscription_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'attempting' CHECK (status IN ('attempting','sent','failed','expired')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  attempted_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  last_http_status integer, last_error text,
  UNIQUE(season, week, alert_key, subscription_id)
);
CREATE INDEX IF NOT EXISTS parlay_ticket_deliveries_week_idx ON public.parlay_ticket_alert_deliveries(season, week);
ALTER TABLE public.parlay_ticket_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parlay_ticket_alert_deliveries FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_parlay_ticket_dead(
  p_season integer, p_week integer, p_alert_key text, p_reason text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE current_key text;
BEGIN
  INSERT INTO public.parlay_ticket_state (season,week) VALUES (p_season,p_week)
  ON CONFLICT DO NOTHING;
  UPDATE public.parlay_ticket_state
  SET status = 'dead', dead_alert_key = p_alert_key,
    dead_reason = left(p_reason,400), dead_at = now(), updated_at = now()
  WHERE season = p_season AND week = p_week AND status = 'alive';
  SELECT dead_alert_key INTO current_key FROM public.parlay_ticket_state
  WHERE season = p_season AND week = p_week;
  RETURN current_key;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mark_parlay_ticket_dead(integer,integer,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_parlay_ticket_dead(integer,integer,text,text) TO service_role;

-- Claims are atomic and reject all new HIT alerts once ticket is dead.
-- A DEAD alert can only use the one key stored for the first verified loss.
CREATE OR REPLACE FUNCTION public.claim_parlay_ticket_alert(
  p_season integer, p_week integer, p_alert_key text, p_kind text,
  p_source_team_id integer, p_subscription_id uuid
) RETURNS TABLE(delivery_id uuid, attempts integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE ticket_status text; ticket_dead_key text;
BEGIN
  SELECT status, dead_alert_key INTO ticket_status, ticket_dead_key
  FROM public.parlay_ticket_state WHERE season=p_season AND week=p_week FOR UPDATE;
  IF ticket_status IS NULL OR
    (p_kind = 'hit' AND ticket_status <> 'alive') OR
    (p_kind = 'dead' AND (ticket_status <> 'dead' OR p_alert_key IS DISTINCT FROM ticket_dead_key))
  THEN RETURN; END IF;
  RETURN QUERY
    INSERT INTO public.parlay_ticket_alert_deliveries AS d
      (season,week,alert_key,kind,source_team_id,subscription_id,status,attempt_count,attempted_at)
    VALUES (p_season,p_week,p_alert_key,p_kind,p_source_team_id,p_subscription_id,'attempting',1,now())
    ON CONFLICT (season,week,alert_key,subscription_id)
    DO UPDATE SET status='attempting',attempt_count=d.attempt_count+1,
      attempted_at=now(), last_http_status=NULL, last_error=NULL
    WHERE d.attempt_count<3 AND
      (d.status='failed' OR (d.status='attempting' AND d.attempted_at < now()-INTERVAL '2 minutes'))
    RETURNING d.id, d.attempt_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_parlay_ticket_alert(integer,integer,text,text,integer,uuid)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_parlay_ticket_alert(integer,integer,text,text,integer,uuid)
TO service_role;

-- Extend the private reminder-Vault based dispatchers for early Sunday games.
-- Retains existing token check, URL derivation and existing 11:45/11:56 jobs.
CREATE OR REPLACE FUNCTION ffball_private.ffball_enqueue_snapshot(p_dry_run boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $job$
DECLARE
  chicago_time timestamp := now() AT TIME ZONE 'America/Chicago';
  weekday integer := extract(dow FROM chicago_time);
  minute_of_day integer := extract(hour FROM chicago_time)*60+extract(minute FROM chicago_time);
  reminder_url text; snapshot_url text; token text; request_id bigint;
BEGIN
  IF NOT p_dry_run AND NOT (weekday=0 AND (
      (minute_of_day>=480 AND minute_of_day<490) OR
      (minute_of_day>=705 AND minute_of_day<715) OR
      (minute_of_day>=716 AND minute_of_day<720)
    )) THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO reminder_url FROM vault.decrypted_secrets
    WHERE name='ffball_reminder_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets
    WHERE name='ffball_reminder_token' LIMIT 1;
  IF reminder_url IS NULL OR reminder_url !~ '^https://[^/]+/api/cron/parlay-reminders$'
     OR token IS NULL OR length(token)<12 THEN
    RAISE EXCEPTION 'Missing reminder URL/token in Supabase Vault';
  END IF;
  snapshot_url := regexp_replace(reminder_url,'/api/cron/parlay-reminders$','/api/cron/parlay-snapshot');
  IF p_dry_run THEN snapshot_url := snapshot_url||'?dryRun=1'; END IF;
  SELECT net.http_get(url:=snapshot_url,
    headers:=jsonb_build_object('Authorization','Bearer '||token),
    timeout_milliseconds:=60000) INTO request_id;
  INSERT INTO public.parlay_snapshot_dispatches(request_id,is_test)
    VALUES(request_id,p_dry_run);
  RETURN request_id;
END;
$job$;
REVOKE ALL ON FUNCTION ffball_private.ffball_enqueue_snapshot(boolean) FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION ffball_private.ffball_enqueue_live_hit(p_dry_run boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $job$
DECLARE
  chicago_time timestamp := now() AT TIME ZONE 'America/Chicago';
  day_of_week integer := extract(dow FROM chicago_time);
  hour_of_day integer := extract(hour FROM chicago_time);
  minute_of_hour integer := extract(minute FROM chicago_time);
  reminder_url text; live_url text; token text; request_id bigint;
BEGIN
  IF NOT p_dry_run AND NOT (
    (day_of_week=0 AND (hour_of_day>8 OR (hour_of_day=8 AND minute_of_hour>=15)))
    OR (day_of_week=1 AND hour_of_day<3)
  ) THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO reminder_url FROM vault.decrypted_secrets
    WHERE name='ffball_reminder_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets
    WHERE name='ffball_reminder_token' LIMIT 1;
  IF reminder_url IS NULL OR reminder_url !~ '^https://[^/]+/api/cron/parlay-reminders$'
    OR token IS NULL OR length(token)<12 THEN
    RAISE EXCEPTION 'Missing reminder URL/token in Supabase Vault';
  END IF;
  live_url := regexp_replace(reminder_url,'/api/cron/parlay-reminders$','/api/cron/parlay-live-hits');
  IF p_dry_run THEN live_url := live_url||'?dryRun=1'; END IF;
  SELECT net.http_get(url:=live_url,
    headers:=jsonb_build_object('Authorization','Bearer '||token),
    timeout_milliseconds:=60000) INTO request_id;
  INSERT INTO public.parlay_live_hit_dispatches(request_id,is_test)
    VALUES(request_id,p_dry_run);
  RETURN request_id;
END;
$job$;
REVOKE ALL ON FUNCTION ffball_private.ffball_enqueue_live_hit(boolean) FROM public,anon,authenticated;
COMMIT;

-- AFTER migration, deployment, and read-only checks, add ONLY this NEW 8 AM job:
-- SELECT cron.schedule('ffball-parlay-snapshot-early','0,5 13,14 * * 0',
--   $$SELECT ffball_private.ffball_enqueue_snapshot(false);$$);
-- The existing noon snapshot and live-hit cron jobs must not be duplicated.
