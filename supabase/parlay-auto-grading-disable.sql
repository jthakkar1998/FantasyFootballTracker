-- Disables auto-grading without affecting Sunday snapshots or reminders.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'ffball-parlay-auto-grade';
-- Also set PARLAY_AUTO_GRADING_ENABLED=false in Vercel for defense in depth.
