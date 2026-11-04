-- Stops ONLY the FanDuel line snapshot schedules. Does not affect the existing
-- push-reminder schedules, ESPN sync, submissions, or stored snapshots.
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname IN ('ffball-parlay-snapshot-backup', 'ffball-parlay-snapshot-primary');
