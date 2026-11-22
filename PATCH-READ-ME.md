# FFBall Dashboard — live-alert readiness & Anytime Touchdown fix

**Source baseline:** user-uploaded `FantasyFootballTracker-main (3).zip` (November 18 checkout; branch/commit not independently verified).

**Scope:** changed files only. Copy the files at their original relative paths into a fresh feature branch from the actual GitHub `main`, reviewing the diff before merging. **Do not overwrite a newer production repository with this whole ZIP.**

## Changes

1. **Pregame readiness:** Commissioner button becomes **Check ticket readiness (read-only)**. Shows all selections verified vs pending vs attention, total verified legs, detailed per-leg pregame evidence and a separate status for each live statistic. A missing scheduled 11:55 CT eligibility lock or the expected pregame snapshot is **Pending** before kickoff, not evidence the player is ineligible. An explicit failed lock or missing evidence after kickoff is **Attention**. Readiness is never fabricated and the preview does not run the lock job.
2. **No league-wide blocking from missing live stats:** ESPN game-stat gaps are tracked separately from unresolved teams, opponent-starter eligibility, exact NFL game identity and pregame snapshot validation. Only structural/pregame problems pause *all* positive hit notifications. ESPN missing live stats affect only the relevant leg. Verified in-game hits can still notify all registered devices; definitive genuine final misses still permanently end that week's ticket.
3. **Anytime Touchdown YES:** Before any confirmed TD, show **Waiting**, even when ESPN omits a rushing or receiving row entirely. A positive ESPN rushing or receiving TD counts even if the other category is missing. Explicit positive athlete-ID-matched kickoff/punt-return/defensive/interception-return TD columns also count. **Passing TDs do not count as the QB scoring an Anytime TD.** Never infer zero/miss from omitted rows. A zero/unreported TD at final remains for manual review (return/fumble TD and sportsbook void caveats). Live hits are provisional.
4. **General missing live stats:** If a game is not final, an unavailable metric shows **Waiting** rather than falsely implying a losing wager; final unavailable stats still require manual review.

## Changed paths

- `lib/parlay-grade-core.ts`
- `lib/parlay-live-hit-core.ts`
- `lib/parlay-live-hits.ts`
- `lib/parlay-ticket-core.ts`
- `components/ParlayLiveHitReport.tsx`
- `app/globals.css`
- `tests/parlay-live-hits.test.ts`
- `tests/parlay-league-ticket.test.ts`

**No SQL schema updates, new environment variables, Cron changes, or production mutations** are included. No changes to official grading persistence, commissioner payment records, or recap/punishment features.

## Verification performed

- **26 targeted regression tests passed** for league ticket, live hits and grading using a local TypeScript-to-JavaScript transpilation runner (Node test). Added coverage for in-game absent stats, positive rushing/receiving/return TD, no passing-TD false positives, partial feed outages, pregame lock pending/failed states, and blocked vs allowed broadcasts.
- Full `npm test`, `npx tsc --noEmit`, and `npm run build` **not completed**: this runtime could not install the repository's dependencies (install timed out), so complete integration/build verification is still required in the normal GitHub/Vercel environment. Do not treat this as a deploy-validated patch.

## Safe deployment

1. Branch from latest `main` and compare these exact changed files against live source; resolve any intervening changes rather than overwriting them.
2. Run `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run build` on the branch. Check 11:55 lock and 11:56 snapshot behavior, 10-team/no-bet reconciliation, and mobile table scrolling.
3. Deploy to **Vercel Preview** with live-send flags disabled, especially when Preview shares Production Supabase. Use only the read-only commissioner preview. Never trigger a mock Miss or a real push in the shared database.
4. Review the resulting preview, merge into `main`, and verify Vercel Production Ready and exact SHA. Check live push outcomes only from authentic game events and actual registered devices. Reminder jobs, early/backup/primary snapshot jobs and league flags remain untouched.
5. **Rollback:** revert these changed app files, or immediately set `PARLAY_LEAGUE_TICKET_NOTIFICATIONS_ENABLED=false` and redeploy to disable league-wide broadcasts if needed. The kill switch does not disable reminder jobs or modify old records.

## Important lock-time investigation (if pending at 11:57–11:59)

The `eligibility_at_lock` field only becomes true/false when `ensureParlayWeekLocked` succeeds. Current `vercel.json` defines DST-covering UTC routes `/api/cron/parlay-lock` and `/api/cron/parlay-lock-late`. Delays or failures can leave the field null, and the new preview reports that rather than falsely marking the player ineligible. Before modifying the scheduler or forcing eligibility values, inspect the Vercel Cron logs and safely query the current Supabase lock/submission state:

```sql
-- Read-only; filter season/week to the specific Sunday after confirming week number.
SELECT season, week, deadline_at, locked_at
FROM public.parlay_week_locks
ORDER BY season DESC, week DESC LIMIT 10;

SELECT season, week, team_name, player_name, eligibility_at_lock, eligibility_reason
FROM public.parlay_submissions
WHERE withdrawn_at IS NULL
ORDER BY season DESC, week DESC, team_name ASC LIMIT 40;
```

**Important:** a green readiness indicator confirms verified prerequisites; it **does not guarantee** a handset will display a push. Check actual device receipt. A newly deployed monitor can potentially notify on a cumulative threshold that was already crossed earlier in the game; review the mid-slate deployment timing before merging.
