-- Run AFTER the new app code is deployed and 8 AM snapshots are validated.
-- The existing 11:45 and 11:56 snapshot jobs must remain untouched.
-- UTC schedule covers both CST and CDT. Private function restricts dispatch
-- to Sunday 8:00-8:09 AM America/Chicago, with a retry at 8:05.
SELECT cron.schedule(
  'ffball-parlay-snapshot-early',
  '0,5 13,14 * * 0',
  $$SELECT ffball_private.ffball_enqueue_snapshot(false);$$
);
