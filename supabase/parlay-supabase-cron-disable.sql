-- Optional rollback: stops only Supabase's new parlay reminder schedules.
-- Historical records, device registrations, and existing cron jobs remain intact.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'ffball-parlay-thu-fri-sat-night',
  'ffball-parlay-sunday-morning',
  'ffball-parlay-sunday-urgent'
);
