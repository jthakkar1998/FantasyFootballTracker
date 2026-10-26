# Commissioner bulk entry, CSV import, and save confirmation

This is an additive patch for the **already deployed Week 1 / off-app tracking upgrade**.
There is **no new SQL migration** and no new environment variable.

## New features

- The commissioner table is editable without a full page refresh. Edit multiple teams/weeks, then click **Save all changes** (top or bottom) or **Save row**.
- An edited row says **Unsaved**. After successful persistence, the row turns green and shows **Saved · edit to update**. Failed rows retain edits and show an error.
- Result selectors now have a dedicated, legible column. On narrow screens, the table scrolls horizontally instead of compressing the result field.
- **Download CSV template** exports all team/week rows, including historical values. Open in Excel, fill the columns, save as CSV, then **Import filled CSV**. Import only stages changes locally; **Save all changes** writes them to Supabase.
- The CSV schema is: `season,week,team_id,team_name,source,bet_details,result,payment_received`.
  - source: `outside` for texted bets, `none` for no pick, or `website` for existing submitted picks.
  - result: `pending`, `hit`, `miss`, `push`, `void`.
  - payment_received: `yes` or `no`.
  - Team IDs identify records; don't change `season`, `week`, `team_id`, or `source=website` for a website pick.
- Payment receipt and results can be edited independently for a website pick. The original website-submitted betting line remains read-only.
- No unsubmitted CSV data is written to the database; CSV errors reject the import without partially applying any changes.

## GitHub website deployment

Create a branch from your current **main** and upload these files to their exact paths (recommended: press `.` on GitHub to use github.dev and move or create files inside their intended folders):

- `app/admin/page.tsx` (modified)
- `app/globals.css` (modified)
- `components/CommissionerParlayManager.tsx` (new)
- `lib/parlay-bulk.ts` (new)
- `lib/parlay-tracking-db.ts` (modified)
- `app/api/admin/parlay/bulk/route.ts` (new)
- `tests/parlay-bulk.test.ts` (new)
- `PARLAY-BULK-ENTRY-SETUP.md` (new)

Confirm the Vercel preview build passes, then merge the pull request. **Do not rerun the old Supabase migration.** The existing `parlay_weekly_team_tracking` table is reused.

## How to fill Weeks 1–7 quickly

1. Open `/admin` and scroll to **Weekly bets & $1 payments**.
2. Click **Download CSV template**. It includes Week 1 onward (through the current week) for every team.
3. In Excel, work across Weeks 1–7. For a texted pick, set `source=outside`, type `bet_details`, set `result=hit/miss/push/void/pending`, and set `payment_received=yes` only if you've verified the $1.
4. Save as **CSV UTF-8**. Click **Import filled CSV** on the site.
5. Check the displayed count of unsaved rows. Spot-check a week or two before clicking **Save all changes**.
6. A success message reports how many rows were saved. If any failed, they remain highlighted as unsaved, with the specific error. You can retry saving.

Caution: Download a fresh template before bulk entry; editing a stale exported file may change data updated after that export. The import validates each season/week/team and forbids turning a website pick into an off-app pick.
