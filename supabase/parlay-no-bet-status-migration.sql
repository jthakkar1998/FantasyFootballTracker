-- Add an explicit No Bet Placed result for commissioner-tracked team/week rows.
-- Run ONCE in Supabase SQL Editor BEFORE deploying the new website code.
-- Safe for existing history: the migration does not update/delete any data rows.
BEGIN;

ALTER TABLE public.parlay_weekly_team_tracking
  DROP CONSTRAINT IF EXISTS parlay_weekly_team_tracking_outside_result_status_check;

ALTER TABLE public.parlay_weekly_team_tracking
  ADD CONSTRAINT parlay_weekly_team_tracking_outside_result_status_check
  CHECK (outside_result_status IN ('pending', 'hit', 'miss', 'push', 'void', 'no_bet'));

-- An explicit non-bet must not simultaneously be recorded as an off-app wager.
-- Payments are intentionally *not* cleared: keep existing verified evidence intact.
ALTER TABLE public.parlay_weekly_team_tracking
  DROP CONSTRAINT IF EXISTS parlay_weekly_team_tracking_no_bet_consistency_check;

ALTER TABLE public.parlay_weekly_team_tracking
  ADD CONSTRAINT parlay_weekly_team_tracking_no_bet_consistency_check
  CHECK (
    outside_result_status <> 'no_bet'
    OR (submitted_outside_app = false AND outside_bet_details IS NULL)
  );

COMMIT;
