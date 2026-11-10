-- Stops live hit polling only. Existing reminders/snapshots/grading unaffected.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'ffball-parlay-live-hits';
-- Also set PARLAY_LIVE_HITS_ENABLED=false in Vercel Production and redeploy.
