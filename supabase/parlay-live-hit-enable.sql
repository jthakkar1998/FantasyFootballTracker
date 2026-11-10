-- ENABLE ONLY after the read-only preview is verified, Vercel Production
-- PARLAY_LIVE_HITS_ENABLED=true is set, and the site has been redeployed.
-- Every three minutes Sundays and Mondays (UTC); the DB and Vercel server
-- double-check America/Chicago Sunday noon–Monday 3 AM before doing any work.
-- Re-running by same name replaces the schedule, not the other Cron jobs.
SELECT cron.schedule(
  'ffball-parlay-live-hits',
  '*/3 * * * 0,1',
  $$SELECT ffball_private.ffball_enqueue_live_hit(false);$$
);
