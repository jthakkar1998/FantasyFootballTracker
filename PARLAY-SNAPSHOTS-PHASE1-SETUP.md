# FFBall: Sunday FanDuel snapshots, Phase 1

This patch is based on the **November 3, 2026 `main` ZIP**, including your Supabase Cron reminder upgrade. It does **not** include automatic grading. No historical picks, off-app bets, `result_status`, Venmo verifications, punishments, or reminder subscriptions are updated.

## What it does

- Sunday **11:45 AM America/Chicago**: capture backup FanDuel lines for current website-submitted parlay picks. Retry at 11:50 and 11:54 **only for lines that still lack a successful backup**.
- Sunday **11:55 AM**: existing pick lock remains unchanged.
- Sunday **11:56 AM America/Chicago**: capture primary FanDuel lines. Retry at 11:57 and 11:58 only for missing primary lines.
- Only fetch current picks' exact event IDs and odd IDs, batched in one uncached SportsGameOdds call. Do not snapshot all available props.
- Store source quote timestamp and snapshot capture timestamp separately. Only accept pregame FanDuel quotes with proper player, stat, side, an available market, and an updated timestamp within 20 minutes. **The provider's free feed can still lag actual FanDuel**.
- Keep initial submission line permanently unchanged. The Commissioner read-only report displays primary line, backup fallback, or manual-review status, plus job diagnostics.
- Off-app bets remain manual. **No bet grading takes place in Phase 1.**

## Exact changed paths (14 files: 4 modified, 10 added, 0 deleted)

Modified:

- `.env.example`
- `app/admin/page.tsx`
- `app/globals.css`
- `lib/sports-odds.ts`

New:

- `PARLAY-SNAPSHOTS-PHASE1-SETUP.md`
- `app/api/cron/parlay-snapshot/route.ts`
- `components/ParlaySnapshotReport.tsx`
- `lib/parlay-snapshot-core.ts`
- `lib/parlay-snapshot-db.ts`
- `lib/parlay-snapshots.ts`
- `supabase/parlay-line-snapshots-migration.sql`
- `supabase/parlay-line-snapshots-enable.sql`
- `supabase/parlay-line-snapshots-disable.sql`
- `tests/parlay-snapshots.test.ts`

**Do not upload files into the GitHub repository root when their paths include subdirectories.** Use github.dev's Explorer on your new feature branch, then verify file paths under Pull Request -> Files changed.

## Recommended safe deployment order

1. **Supabase: migrate only.** In SQL Editor, execute `supabase/parlay-line-snapshots-migration.sql` in full. This creates three new tables and private database functions. It does not schedule anything yet. Confirm `public.parlay_line_snapshots`, `public.parlay_snapshot_runs`, and `public.parlay_snapshot_dispatches` exist.
2. **GitHub:** Create branch `parlay-snapshots-phase1` from latest `main`. Apply the 14 changed files at exactly their listed paths, commit, and create a PR. Existing `main` and all other schedules remain unchanged.
3. **Vercel:** Add **Production Config** environment variable `PARLAY_SNAPSHOTS_ENABLED=true`. This is not a secret. Keep `SPORTSGAMEODDS_API_KEY` and `PARLAY_REMINDER_CRON_SECRET` unchanged. There is **no new push key or Supabase Vault secret**.
4. **Vercel:** Verify the PR preview build passes. Merge into `main` after review. Ensure the new `main` Production deployment shows **Ready** and the Commissioner page loads.
5. **Dry-run the Supabase-to-Vercel connection** (never sends pushes, grades picks, or requests SportsGameOdds data):

   ```sql
   select ffball_private.ffball_test_snapshot_connection() as request_id;
   ```

   The returned number is an **enqueued** request ID, not proof of success. After several seconds, inspect the response and confirm HTTP 200 and JSON `status:"preview"`:

   ```sql
   select d.queued_at, d.request_id, r.status_code, r.content
   from public.parlay_snapshot_dispatches d
   left join net._http_response r on r.id = d.request_id
   where d.is_test = true
   order by d.queued_at desc
   limit 5;
   ```

   If the response has 401, check that `ffball_reminder_token` in Supabase Vault matches `PARLAY_REMINDER_CRON_SECRET` in Vercel Production. A 404 suggests the new production deployment isn't live. HTTP 500 indicates inspect Vercel function logs.
6. **Enable the two Supabase scheduled jobs** by running `supabase/parlay-line-snapshots-enable.sql` in Supabase SQL Editor. The enable file contains **only** the new snapshot schedules and does not affect the reminder jobs.
7. **Verify the schedules** with:

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname like 'ffball-parlay-snapshot-%'
   order by jobname;
   ```

   You should see `ffball-parlay-snapshot-backup` and `ffball-parlay-snapshot-primary`. On Sunday, inspect **Supabase Cron History**, `public.parlay_snapshot_runs`, and the Commissioner report. It is normal for current-week lines to show "Not captured" before the scheduled window.

## Troubleshooting and safe rollback

- No run recorded: inspect Supabase Cron History and `parlay_snapshot_dispatches`/`net._http_response`; confirm `PARLAY_SNAPSHOTS_ENABLED=true` on the latest **Production** deployment. The Cron scheduler uses UTC candidate hours and the private function verifies actual Chicago wall time to account for DST.
- Run logged with missing markets: check errors in Commissioner snapshot job activity. An unavailable, started, mismatched, or stale FanDuel quote is **not guessed or replaced with the Thursday line**.
- 429 / allowance warning: SportsGameOdds Amateur can throttle. This job makes at most one **batched** selected-market request per execution; its retry windows only fetch missing picks. The site shows a warning above 75% of the current API key's reported monthly entity allowance.
- To stop snapshots immediately without touching reminders or records, run **`supabase/parlay-line-snapshots-disable.sql`**. You can also set `PARLAY_SNAPSHOTS_ENABLED=false` in Vercel Production and redeploy.
- An existing lineup change between 11:45 and 11:55 cannot make an earlier backup applicable to a changed selection: row matching validates the actual event, player, market, stat, and side.
- `net._http_response` entries may be cleaned up automatically; use `parlay_snapshot_dispatches` and Vercel logs if older responses have expired.

## Tests and remaining verification

The `tests/parlay-snapshots.test.ts` suite checks local time boundaries (including DST), exact FanDuel lines, missing/suspended/stale quotes, yes/no props, changed selections, SQL guards, and endpoint authentication. No SportsGameOdds or Supabase credentials were used in local tests. A full Next.js production build and real API/Supabase delivery still require verification after deployment.

Provider docs: https://sportsgameodds.com/docs/endpoints/getEvents ; https://sportsgameodds.com/docs/data-types/odds ; https://supabase.com/docs/guides/cron
