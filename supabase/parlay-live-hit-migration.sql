-- PHASE 2 LIVE HIT ALERTS: additive migration, run after/alongside the
-- parlay-auto-grading-migration.sql, BEFORE deploying new application code.
-- No past picks, manual grades, $1 payments, reminder rows or snapshots modified.
BEGIN;

-- ESPN pro-team ID is verified on the website at original submission time.
-- Historical submissions are deliberately left NULL (no guess/backfill).
ALTER TABLE public.parlay_submissions ADD COLUMN IF NOT EXISTS pro_team_id integer;

-- One accepted notification per pick per registered device. Failed delivery
-- retries are bounded. Never stores VAPID keys, device endpoint or secrets.
CREATE TABLE IF NOT EXISTS public.parlay_live_hit_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  week integer NOT NULL CHECK (week BETWEEN 1 AND 22),
  team_id integer NOT NULL,
  submission_id uuid NOT NULL REFERENCES public.parlay_submissions(id),
  subscription_id uuid NOT NULL,
  nfl_event_id text NOT NULL,
  stat_id text NOT NULL,
  side_id text NOT NULL,
  frozen_line text,
  observed_value numeric NOT NULL,
  game_final boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'attempting'
    CHECK (status IN ('attempting', 'sent', 'failed', 'expired')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  sent_at timestamptz,
  last_http_status integer,
  last_error text,
  UNIQUE (submission_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS parlay_live_hit_deliveries_week_idx
  ON public.parlay_live_hit_deliveries (season DESC, week DESC, attempted_at DESC);
ALTER TABLE public.parlay_live_hit_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_live_hit_deliveries FROM anon, authenticated;

-- Atomic claim protects against concurrent Supabase calls and repeated alerts.
CREATE OR REPLACE FUNCTION public.claim_parlay_live_hit_delivery(
  p_season integer, p_week integer, p_team_id integer, p_submission_id uuid,
  p_subscription_id uuid, p_nfl_event_id text, p_stat_id text,
  p_side_id text, p_frozen_line text, p_observed_value numeric, p_game_final boolean
) RETURNS TABLE(delivery_id uuid, attempts integer)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $claim$
  INSERT INTO public.parlay_live_hit_deliveries AS d
    (season, week, team_id, submission_id, subscription_id, nfl_event_id, stat_id,
     side_id, frozen_line, observed_value, game_final, status, attempted_at, attempt_count)
  VALUES (p_season, p_week, p_team_id, p_submission_id, p_subscription_id,
          p_nfl_event_id, p_stat_id, p_side_id, p_frozen_line, p_observed_value,
          p_game_final, 'attempting', now(), 1)
  ON CONFLICT (submission_id, subscription_id)
  DO UPDATE SET status = 'attempting', attempted_at = now(),
    attempt_count = d.attempt_count + 1,
    observed_value = EXCLUDED.observed_value, game_final = EXCLUDED.game_final,
    last_http_status = NULL, last_error = NULL
  WHERE d.attempt_count < 3 AND
    (d.status = 'failed' OR
     (d.status = 'attempting' AND d.attempted_at < now() - INTERVAL '2 minutes'))
  RETURNING d.id, d.attempt_count;
$claim$;
REVOKE ALL ON FUNCTION public.claim_parlay_live_hit_delivery(
  integer,integer,integer,uuid,uuid,text,text,text,text,numeric,boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_parlay_live_hit_delivery(
  integer,integer,integer,uuid,uuid,text,text,text,text,numeric,boolean)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.parlay_live_hit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  season integer NOT NULL,
  week integer,
  status text NOT NULL CHECK (status IN ('success','partial','idle','error')),
  eligible_picks integer NOT NULL DEFAULT 0,
  currently_hitting integer NOT NULL DEFAULT 0,
  attempted integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS parlay_live_hit_runs_started_idx
  ON public.parlay_live_hit_runs(started_at DESC);
ALTER TABLE public.parlay_live_hit_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_live_hit_runs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.parlay_live_hit_dispatches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint NOT NULL,
  is_test boolean NOT NULL DEFAULT false
);
ALTER TABLE public.parlay_live_hit_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_live_hit_dispatches FROM anon, authenticated;

CREATE SCHEMA IF NOT EXISTS ffball_private;
REVOKE ALL ON SCHEMA ffball_private FROM public, anon, authenticated;
-- Reuses the already-installed private Supabase Vault reminder URL + token.
-- A dry-run request works outside Sunday hours; live calls cannot be queued
-- unless Sunday noon–midnight or Monday before 3 AM America/Chicago.
CREATE OR REPLACE FUNCTION ffball_private.ffball_enqueue_live_hit(p_dry_run boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $job$
DECLARE
  chicago_time timestamp := now() AT TIME ZONE 'America/Chicago';
  day_of_week integer := extract(dow FROM chicago_time);
  hour_of_day integer := extract(hour FROM chicago_time);
  reminder_url text;
  live_url text;
  token text;
  request_id bigint;
BEGIN
  IF NOT p_dry_run AND NOT ((day_of_week = 0 AND hour_of_day >= 12)
    OR (day_of_week = 1 AND hour_of_day < 3)) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO reminder_url FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_token' LIMIT 1;
  IF reminder_url IS NULL OR reminder_url !~ '^https://[^/]+/api/cron/parlay-reminders$'
     OR token IS NULL OR length(token) < 12 THEN
    RAISE EXCEPTION 'Missing Supabase Vault reminder URL/token for live hit alerts';
  END IF;
  live_url := regexp_replace(reminder_url, '/api/cron/parlay-reminders$', '/api/cron/parlay-live-hits');
  IF p_dry_run THEN live_url := live_url || '?dryRun=1'; END IF;
  SELECT net.http_get(
    url := live_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 60000
  ) INTO request_id;
  INSERT INTO public.parlay_live_hit_dispatches(request_id, is_test)
    VALUES (request_id, p_dry_run);
  RETURN request_id;
END;
$job$;
REVOKE ALL ON FUNCTION ffball_private.ffball_enqueue_live_hit(boolean)
  FROM public, anon, authenticated;
CREATE OR REPLACE FUNCTION ffball_private.ffball_test_live_hit_connection()
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT ffball_private.ffball_enqueue_live_hit(true);
$test$;
REVOKE ALL ON FUNCTION ffball_private.ffball_test_live_hit_connection()
  FROM public, anon, authenticated;
COMMIT;
-- Migration alone DOES NOT schedule or send any push notifications.
