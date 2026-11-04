-- PHASE 1 ACTIVATION. Execute once AFTER the new production Vercel code is
-- Ready, PARLAY_SNAPSHOTS_ENABLED=true, and the dry-run connection test passed.
-- Supabase pg_cron uses UTC; both possible offsets are present here.
-- The private function also verifies America/Chicago time before dispatch.
-- Backup 11:45 AM CT (retries at 11:50, 11:54 when a valid quote is missing).
SELECT cron.schedule(
  'ffball-parlay-snapshot-backup',
  '45,50,54 16,17 * * 0',
  $$SELECT ffball_private.ffball_enqueue_snapshot(false);$$
);
-- Primary 11:56 AM CT (retries at 11:57/11:58 only when needed).
SELECT cron.schedule(
  'ffball-parlay-snapshot-primary',
  '56,57,58 16,17 * * 0',
  $$SELECT ffball_private.ffball_enqueue_snapshot(false);$$
);
