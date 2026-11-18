# Commissioner Sunday Snapshot Layout Fix

A small presentation-only patch based on the current merged League Ticket + Early Snapshots version.

## Installation
1. Create a feature branch from the current `main`.
2. Copy `components/ParlaySnapshotReport.tsx` and `app/globals.css` into the same relative folders, replacing those two files.
3. Commit and check the Vercel Preview build. On Commissioner > Sunday line snapshots and history, verify the empty Week 11 state and an older week with saved picks.
4. Merge the branch only after those layout checks pass.

## Changes
- Gives all six snapshot columns explicit widths totaling 100%, with a 1020px minimum table width and horizontal scrolling on narrower screens.
- Hides the table entirely when the selected week has no website picks, replacing it with a compact informational message.
- Leaves snapshot selection, timing, Supabase queries, grading, reminders, and live notifications unchanged.

## Other setup
No Supabase migration, Cron job, or Vercel environment-variable change is needed.
