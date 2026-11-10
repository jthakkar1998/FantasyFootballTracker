-- PHASE 2 - DO NOT RUN UNTIL READ-ONLY GRADING PREVIEWS ARE VERIFIED.
-- AFTER checking Week 9 results and setting PARLAY_AUTO_GRADING_ENABLED=true
-- in Vercel Production and redeploying, run this SQL to activate.
-- Supabase Cron is UTC. Both possible Chicago DST offsets are scheduled;
-- the server and private DB function verify Chicago local time.
SELECT cron.schedule(
  'ffball-parlay-auto-grade',
  '15,45 14,15 * * 1,2',
  $$SELECT ffball_private.ffball_enqueue_grade(false, NULL);$$
);
