-- Optional rollback of only the NEW preliminary capture job.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'ffball-parlay-snapshot-early';
