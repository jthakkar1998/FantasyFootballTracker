# ESPN Reliability Preview Build Fix

## The issue
The previous ESPN reliability upgrade replaced `lib/sports-odds.ts` using a version that lacked two exports added by the working Sunday snapshot Phase 1 implementation:

- `fetchSnapshotFanDuelMarkets` — used by the snapshot Cron job to fetch current FanDuel markets without stale website cache.
- `fetchSportsOddsUsage` — used by the snapshot Cron job to read the SportsGameOdds monthly usage information.

Next.js correctly rejected the import from `lib/parlay-snapshots.ts` at build time.

## Install (on existing `fix/espn-schedule-reliability` feature branch)
1. **Do not install the earlier temporary Parlay 403 hotfix.**
2. Unzip this package.
3. In GitHub, on your **existing** `fix/espn-schedule-reliability` branch, replace **only** `lib/sports-odds.ts` with the file from this ZIP, preserving its path. Upload `tests/sports-odds-contract.test.ts` if you want the added regression test; it is optional for the app.
4. Commit and let Vercel rebuild the **Preview** deployment.
5. Check that the import/export error is gone and the Preview build reports **Ready**. If it reports a different error, inspect the new log before merging.
6. Confirm the Parlay page loads, props can be requested without a schedule 403, and the read-only Week 9 Commissioner preview still shows the expected results.
7. Merge into `main` only after the Preview build and read-only checks pass.

## What changes (and what doesn't)
- Retains the reliability update's SportsGameOdds Sunday-game matching and cached schedule behavior.
- Restores the two Phase 1 exports exactly from the latest Sunday snapshots + Supabase Cron package.
- Leaves the direct, uncached FanDuel **snapshot** request independent of the ordinary 10-minute odds cache.
- Does **not** change any SQL, environment variable, Cron job, Sunday cutoff, odds data, grading result, payment state, or push notification setting.

## Validation
- TypeScript parser: no syntax errors.
- Export contract: all five expected public functions exist.
- Added `tests/sports-odds-contract.test.ts`: passing with Node 22 type stripping; also compatible with the repository's existing `tsx --test` runner.
- A complete Next.js `npm run build` could not be run in this environment because the local npm dependency installation was incomplete. **The Vercel Preview build is the required final check.**

This fix is intended to replace the `lib/sports-odds.ts` that shipped in `FFBall-ESPN-Schedule-Reliability-CHANGED-FILES.zip`, **not** to replace other files from that earlier upgrade.
