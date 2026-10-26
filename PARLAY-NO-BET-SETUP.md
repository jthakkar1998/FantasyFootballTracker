# Commissioner: No Bet Placed — deployment and history safety

This is a minimal patch **on top of the already deployed bulk-entry upgrade**. It does not replace your repository or reset any existing records.

## What changes

- The Commissioner **Result** dropdown includes **No Bet Placed** for teams **without an active website pick**. An existing website pick cannot be marked as no bet.
- Selecting **No Bet Placed** sets that team's result to `no_bet`, source to `none`, and removes any off-app bet details **for that selected team/week only**. The Venmo column becomes a grey `Not applicable / No $1 owed` label, and the row no longer counts as an outstanding $1 payment.
- Existing payment verification timestamps **are retained** in Supabase, even for a row now marked No Bet Placed. If you correct a row back to a placed bet, previous payment verification can still be displayed. The UI does not count no-bet rows as unpaid.
- `no_bet` persists across page reloads and CSV round-trips. To fill in CSV, set `source=none`, leave `bet_details` blank, set `result=no_bet`, and set `payment_received=n/a` (this preserves any earlier receipt; `yes/no` still work).
- A future hit-rate dashboard should calculate `hit / (hit + miss)` for settled bets. `no_bet`, `pending`, `push`, and `void` are excluded from the hit-rate denominator. A separate participation metric can include no-bet weeks.

## Deploy in order

1. **Supabase first:** In your existing Supabase project, open **SQL Editor → New Query** and run the entire `supabase/parlay-no-bet-status-migration.sql`. This only expands the existing status CHECK constraint and adds consistency validation. It does **not** delete or update any of your Week 1–7 rows. A database backup beforehand is recommended.
2. **GitHub branch:** From your latest `main` branch create `commissioner-no-bet-status`. Press `.` while viewing the branch to open github.dev. Copy the updated files **into their exact folders**; don't upload them all at repo root.
3. **Commit + push** to the new branch. Create a pull request into `main`.
4. **Check the Vercel Preview build** passes. Don't merge a failing preview. Once green, merge and confirm Vercel Production shows Ready.
5. **Verify:** Open Commissioner, select an old week with no actual wager, choose **No Bet Placed**, check Venmo shows `Not applicable`, click **Save all changes**, reload and confirm persistence. Check other historical bets remain unchanged. Test a CSV export if you use it.

## Patch files (9 total: 7 modified, 2 new)

Modified:
- `app/globals.css`
- `app/api/admin/parlay/bulk/route.ts`
- `components/CommissionerParlayManager.tsx`
- `lib/parlay-admin.ts`
- `lib/parlay-bulk.ts`
- `lib/parlay-tracking-db.ts`
- `tests/parlay-bulk.test.ts`

New:
- `supabase/parlay-no-bet-status-migration.sql`
- `PARLAY-NO-BET-SETUP.md`

**No new Vercel environment variables or GitHub Actions configuration.** The existing notification system and parlay submission code are untouched.

## Verification

21 commissioner unit tests passed in a standalone TypeScript-transpiled Node test run. All modified TypeScript/TSX files transpiled successfully. A full Next.js build could not be run here because npm package downloads failed (registry DNS error). Your GitHub pull request's Vercel preview check is therefore required.
