-- PHASE B: ONLY after the migration, Vault setup, Vercel production deployment,
-- and successful dry-run connectivity test. Supabase cron schedules are UTC.
-- Duplicate CDT/CST candidate hours are intentional; the SQL function enforces
-- exact America/Chicago windows, including daylight-saving transitions.

-- Thu, Fri, Sat 8:00-8:40 PM Central, checked every five minutes.
-- The candidate UTC hours occur Friday/Saturday/Sunday (CDT 01, CST 02).
select cron.schedule(
  'ffball-parlay-thu-fri-sat-night',
  '*/5 1,2 * * 5,6,0',
  $$select ffball_private.ffball_enqueue_reminder(false);$$
);

-- Sunday 9:00-9:25 AM Central (14 UTC in CDT, 15 UTC in CST).
select cron.schedule(
  'ffball-parlay-sunday-morning',
  '*/5 14,15 * * 0',
  $$select ffball_private.ffball_enqueue_reminder(false);$$
);

-- Sunday 11:30-11:50 AM Central (16 UTC in CDT, 17 UTC in CST).
-- No notification is sent once the 11:55 AM CT submission deadline passes.
select cron.schedule(
  'ffball-parlay-sunday-urgent',
  '30,35,40,45,50 16,17 * * 0',
  $$select ffball_private.ffball_enqueue_reminder(false);$$
);
