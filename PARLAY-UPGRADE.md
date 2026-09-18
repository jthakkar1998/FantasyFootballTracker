# Sunday Group Parlay Upgrade

This upgrade adds a separate `/parlay` page. It does not modify or reuse punishment-obligation data.

## What it does

- Uses the current ESPN matchup to determine each fantasy team's opponent.
- Eligible players are the opponent's current starters; D/ST is excluded.
- Only players with an unstarted NFL game on Sunday can return props.
- FanDuel is the only sportsbook shown.
- FanDuel lines come from the SportsGameOdds free API and are cached for 10 minutes.
- One active pick is stored per fantasy team per fantasy week.
- Picks are public to the whole league immediately.
- Picks can be changed or withdrawn until Sunday at 10:30 AM America/Chicago.
- The deadline is enforced on the server, not just in the browser.
- The exact line and odds are saved. If the line changes before submission, the user must refresh before submitting.
- Before the deadline, lineup eligibility is recalculated from ESPN. After lock, the saved lock eligibility is displayed.

## 1. Get a free odds API key

Create a free SportsGameOdds account and copy the API key.

Add this to `.env.local`:

```text
SPORTSGAMEODDS_API_KEY=your-key-here
```

Do not prefix this variable with `NEXT_PUBLIC_`; it must stay server-side.

In Vercel, add `SPORTSGAMEODDS_API_KEY` as a **Secret** environment variable for Production.

## 2. Run the Supabase migration

In Supabase -> SQL Editor -> New snippet, paste and run all contents of:

```text
supabase/parlay-migration.sql
```

It creates only:

- `parlay_submissions`
- `parlay_odds_cache`
- `parlay_week_locks`

It does not modify `obligations` or recap-video data.

## 3. Test locally

Restart the Next.js dev server after adding the API key:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/parlay
```

Test this workflow:

1. Select a fantasy team.
2. Confirm its opponent is correct.
3. Confirm the eligible list contains the opponent's current starters.
4. Click a player.
5. Confirm FanDuel props load.
6. Submit a test pick.
7. Confirm the pick appears under League Picks.
8. Change the pick.
9. Withdraw the pick.

Because local development points at your real Supabase project, test submissions are real database rows. Withdraw them after testing if desired.

## 4. Deploy

Copy the updated files into your Git-connected project, then:

```bash
git status
git add .
git commit -m "Add Sunday parlay board"
git push
```

Vercel will deploy the push automatically.

## Deadline and DST

The application computes the deadline from `America/Chicago`, so daylight saving time is handled automatically. The UI says CT rather than hard-coding CST/CDT.

The API itself rejects every submit/change/withdraw request at or after 10:30 AM CT, so the betting deadline does not depend on a scheduled job.

`vercel.json` also includes Sunday lock-snapshot cron jobs. On Vercel Hobby, cron timing is only hour-level precision, so the snapshot is best-effort; the page also creates the snapshot on the first request after the deadline if a cron has not already done it. The submission cutoff itself remains exact because it is checked synchronously on every request.

## Free API usage

The app requests the full FanDuel NFL Sunday slate only when a user looks up props and the 10-minute cache is stale. All league members share that cache. That keeps the number of returned event objects low enough for a small fantasy league under normal use.
