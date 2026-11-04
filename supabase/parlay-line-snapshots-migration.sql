-- PHASE 1 ONLY. Does not grade bets, replace submission lines, or modify
-- payouts, Venmo verification, outside-app bets, or punishment obligations.
-- Requires the previously installed Supabase reminder Cron/Vault setup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.parlay_line_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.parlay_submissions(id),
  season integer NOT NULL,
  week integer NOT NULL CHECK (week BETWEEN 1 AND 22),
  team_id integer NOT NULL,
  snapshot_slot text NOT NULL CHECK (snapshot_slot IN ('backup', 'primary')),
  event_id text NOT NULL,
  market_id text NOT NULL,
  sportsbook_player_id text NOT NULL,
  stat_id text NOT NULL,
  side_id text NOT NULL,
  line text,
  odds text NOT NULL,
  captured_at timestamptz NOT NULL,
  quote_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, snapshot_slot, event_id, market_id, sportsbook_player_id, stat_id, side_id)
);
CREATE INDEX IF NOT EXISTS parlay_line_snapshots_week_idx ON public.parlay_line_snapshots (season DESC, week DESC);
ALTER TABLE public.parlay_line_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_line_snapshots FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.parlay_snapshot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  season integer NOT NULL,
  week integer NOT NULL,
  slot text NOT NULL CHECK (slot IN ('backup', 'primary')),
  status text NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  attempted integer NOT NULL DEFAULT 0,
  captured integer NOT NULL DEFAULT 0,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  usage_warning text
);
CREATE INDEX IF NOT EXISTS parlay_snapshot_runs_started_idx ON public.parlay_snapshot_runs (season DESC, started_at DESC);
ALTER TABLE public.parlay_snapshot_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_snapshot_runs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.parlay_snapshot_dispatches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint NOT NULL,
  is_test boolean NOT NULL DEFAULT false
);
ALTER TABLE public.parlay_snapshot_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_snapshot_dispatches FROM anon, authenticated;

CREATE SCHEMA IF NOT EXISTS ffball_private;
REVOKE ALL ON SCHEMA ffball_private FROM public, anon, authenticated;

-- Uses the existing, scoped Supabase->Vercel reminder token and production URL.
-- No new secret is required. Derive a known fixed route instead of accepting
-- an arbitrary URL from input or exposing the token to the website frontend.
CREATE OR REPLACE FUNCTION ffball_private.ffball_enqueue_snapshot(p_dry_run boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $job$
DECLARE
  chicago_time timestamp := now() AT TIME ZONE 'America/Chicago';
  weekday integer := extract(dow FROM chicago_time);
  minute_of_day integer := extract(hour FROM chicago_time) * 60 + extract(minute FROM chicago_time);
  inside_window boolean;
  reminder_url text;
  snapshot_url text;
  token text;
  request_id bigint;
BEGIN
  inside_window := (weekday = 0 AND (
    (minute_of_day >= 705 AND minute_of_day < 715) OR
    (minute_of_day >= 716 AND minute_of_day < 720)
  ));
  IF NOT p_dry_run AND NOT inside_window THEN RETURN NULL; END IF;

  SELECT decrypted_secret INTO reminder_url FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_token' LIMIT 1;
  IF reminder_url IS NULL OR reminder_url !~ '^https://[^/]+/api/cron/parlay-reminders$'
    OR token IS NULL OR length(token) < 12 THEN
    RAISE EXCEPTION 'Supabase Vault reminder URL/token not configured for snapshots';
  END IF;
  snapshot_url := regexp_replace(reminder_url, '/api/cron/parlay-reminders$', '/api/cron/parlay-snapshot');
  IF p_dry_run THEN snapshot_url := snapshot_url || '?dryRun=1'; END IF;
  SELECT net.http_get(
    url := snapshot_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 60000
  ) INTO request_id;
  INSERT INTO public.parlay_snapshot_dispatches(request_id, is_test) VALUES (request_id, p_dry_run);
  RETURN request_id;
END;
$job$;
REVOKE ALL ON FUNCTION ffball_private.ffball_enqueue_snapshot(boolean) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION ffball_private.ffball_test_snapshot_connection()
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT ffball_private.ffball_enqueue_snapshot(true);
$test$;
REVOKE ALL ON FUNCTION ffball_private.ffball_test_snapshot_connection() FROM public, anon, authenticated;
COMMIT;
-- WARNING: this migration does NOT activate the schedule. Run the separate
-- enable file only after the production code and dry-run test are verified.
