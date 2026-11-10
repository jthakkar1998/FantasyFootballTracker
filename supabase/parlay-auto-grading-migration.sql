-- PHASE 2: RUN FIRST, BEFORE DEPLOYING THE NEW CODE.
-- Additive only. Never changes existing submitted lines, existing grades,
-- off-app bets, Venmo/payment history, or Sunday snapshot rows.
BEGIN;
ALTER TABLE public.parlay_submissions
  ADD COLUMN IF NOT EXISTS grade_source text;
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parlay_submissions_grade_source_check') THEN
    ALTER TABLE public.parlay_submissions
      ADD CONSTRAINT parlay_submissions_grade_source_check
      CHECK (grade_source IS NULL OR grade_source IN ('manual', 'auto'));
  END IF;
END
$constraint$;
-- Existing Hit/Miss/Push/Void grades were entered before auto-grading existed.
-- Mark them as manual so the automation can never silently change them.
UPDATE public.parlay_submissions
SET grade_source = 'manual'
WHERE result_status <> 'pending' AND grade_source IS NULL;

CREATE TABLE IF NOT EXISTS public.parlay_auto_grade_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  season integer NOT NULL,
  week integer NOT NULL,
  run_source text NOT NULL DEFAULT 'cron' CHECK (run_source IN ('cron', 'commissioner')),
  status text NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  total integer NOT NULL DEFAULT 0,
  ready integer NOT NULL DEFAULT 0,
  review integer NOT NULL DEFAULT 0,
  already_graded integer NOT NULL DEFAULT 0,
  applied integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS parlay_auto_grade_runs_history_idx
  ON public.parlay_auto_grade_runs (season DESC, week DESC, started_at DESC);
ALTER TABLE public.parlay_auto_grade_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_auto_grade_runs FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.parlay_auto_grade_dispatches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint NOT NULL,
  is_test boolean NOT NULL DEFAULT false
);
ALTER TABLE public.parlay_auto_grade_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parlay_auto_grade_dispatches FROM anon, authenticated;

CREATE SCHEMA IF NOT EXISTS ffball_private;
REVOKE ALL ON SCHEMA ffball_private FROM public, anon, authenticated;
-- Existing token and URL in Supabase Vault are reused. No new secret is needed.
CREATE OR REPLACE FUNCTION ffball_private.ffball_enqueue_grade(
  p_dry_run boolean DEFAULT false, p_week integer DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $job$
DECLARE
  chicago_time timestamp := now() AT TIME ZONE 'America/Chicago';
  weekday integer := extract(dow FROM chicago_time);
  minute_of_day integer := extract(hour FROM chicago_time) * 60 + extract(minute FROM chicago_time);
  reminder_url text;
  grading_url text;
  token text;
  request_id bigint;
BEGIN
  -- Cron writes only Monday/Tuesday 9:15–9:50 Central, including DST.
  IF NOT p_dry_run AND NOT (weekday IN (1, 2) AND minute_of_day BETWEEN 555 AND 590) THEN
    RETURN NULL;
  END IF;
  -- Specific-week rechecks are PREVIEW ONLY, never historical write commands.
  IF p_week IS NOT NULL AND (NOT p_dry_run OR p_week < 1 OR p_week > 22) THEN
    RAISE EXCEPTION 'Specific week parameter is allowed only for preview (1–22)';
  END IF;
  SELECT decrypted_secret INTO reminder_url FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_url' LIMIT 1;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets
    WHERE name = 'ffball_reminder_token' LIMIT 1;
  IF reminder_url IS NULL OR reminder_url !~ '^https://[^/]+/api/cron/parlay-reminders$'
    OR token IS NULL OR length(token) < 12 THEN
    RAISE EXCEPTION 'Missing reminder URL/token in Supabase Vault';
  END IF;
  grading_url := regexp_replace(reminder_url, '/api/cron/parlay-reminders$', '/api/cron/parlay-grade');
  IF p_dry_run THEN grading_url := grading_url || '?dryRun=1'; END IF;
  IF p_week IS NOT NULL THEN grading_url := grading_url || '&week=' || p_week::text; END IF;
  SELECT net.http_get(
    url := grading_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token),
    timeout_milliseconds := 60000
  ) INTO request_id;
  INSERT INTO public.parlay_auto_grade_dispatches (request_id, is_test)
    VALUES (request_id, p_dry_run);
  RETURN request_id;
END;
$job$;
REVOKE ALL ON FUNCTION ffball_private.ffball_enqueue_grade(boolean,integer)
  FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION ffball_private.ffball_test_grade_connection(p_week integer DEFAULT 9)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $test$
  SELECT ffball_private.ffball_enqueue_grade(true, p_week);
$test$;
REVOKE ALL ON FUNCTION ffball_private.ffball_test_grade_connection(integer)
  FROM public, anon, authenticated;
COMMIT;
-- NOTE: this migration does NOT activate any grading schedule or grading writes.
