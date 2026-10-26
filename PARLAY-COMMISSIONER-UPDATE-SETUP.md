# Commissioner parlay table update — Week 1 and off-app picks

This small patch is based on the **FantasyFootballTracker-parlay-upgrade** ZIP.
It changes only the commissioner parlay table, creates an admin-only tracking
endpoint, and adds a Supabase table for team/week records without online picks.
It does **not** replace `components/ParlayBoard.tsx`, so any subsequent fix to
team selection or reminders is preserved.

## 1. Update Supabase BEFORE deploying

In your existing Supabase project, open **SQL Editor → New query**. Paste the
entire contents of `supabase/parlay-weekly-team-tracking-migration.sql`, run it,
and confirm `public.parlay_weekly_team_tracking` appears in Table Editor.
This is an **additional** migration; do not rerun your original setup scripts.
The migration copies previously verified payments into the new tracking table.
It does not modify existing parlay picks, grades, punishments, or videos.

## 2. Apply the code via the GitHub website (preserves history)

1. Open your GitHub repository, select `main`, then create a new branch called
   `commissioner-parlay-history` from `main`.
2. Extract the ZIP accompanying this file.
3. On the new branch choose **Add file → Upload files**.
4. Drag the **contents** of the extracted folder (the `app`, `lib`, `supabase`,
   `tests` folders and this Markdown file), not the outer enclosing folder.
5. GitHub should find **8 paths**: 2 modified and 6 new. Check the paths in
   the comparison view; there should be **no deletions**.
6. Commit to `commissioner-parlay-history`. Create a pull request into `main`.
7. Review and merge; Vercel should automatically deploy the new `main` commit.
   No new Vercel environment variables or GitHub Actions secrets are needed.

If additional code changes were made to any of those files since the last
parlay upgrade, review the pull-request diff rather than blindly overwriting.

## 3. What the commissioner now sees

- One row for **every ESPN fantasy team** for every week from **Week 1** through
  the current matchup week, newest weeks first.
- An online pick appears with its player, market, line and odds as before.
- A team without an online pick displays **Did not submit a pick through the website**.
- Click **Mark off-app pick** to indicate a pick was sent directly to the
  commissioner. The status is saved to Supabase, with an optional description
  and manually recorded win/loss/push/void result. Click **Off-app · undo** to
  correct a mistake.
- **Mark $1 received** works on EVERY row, even if the player did not enter
  an online pick. Unchecking that verification is supported too.
- Existing payment verifications are migrated; no earlier verified payments
  should need to be marked again.
- Team/week rows are generated from the league roster. No placeholder bet rows
  are inserted into `parlay_submissions`; this keeps odds and historical bets accurate.

**Scope:** The full team-by-week grid uses the ESPN season configured by
`ESPN_SEASON` (currently 2026); older seasons remain in Supabase. For the entire
roster to load, ESPN needs to be reachable. If ESPN is unavailable, the page
warns you and shows teams identifiable from saved picks/tracking/penalties.

## 4. Test after deployment

1. Open `/admin` and confirm the commissioner table includes **Week 1**.
2. For a past week, choose a team with no website pick and click
   **Mark off-app pick**. Confirm the label changes after the page reloads.
3. Add optional description, mark the result, then mark `$1 received`.
4. Refresh `/admin`. Confirm the off-app status and payment verification remain.
5. Try `Off-app · undo` and `Verified · undo` to confirm reversibility.
6. Verify existing website picks still appear correctly, and that the public
   parlay page, deadline, phone reminders and punishment dashboard are unchanged.

The off-app records are commissioner-only; the public parlay history currently
continues to list website-submitted bets only.
