# Fantasy Punishment Board

A small Next.js dashboard for ESPN Fantasy Football league **666066604**. ESPN remains the source of truth for weekly scores and lineups. Supabase stores only generated punishment obligations and whether the commissioner has marked them complete.

## What v1 tracks

- **Weekly recap:** after a fantasy week is final, the lowest-scoring team is automatically identified. A tie creates a recap obligation for every tied low scorer. The deadline is the first NFL kickoff of the following regular-season week.
- **0-point starter:** 1 Ice owed.
- **Negative-point starter:** 2 Ices owed.
- **Empty starting slot:** 3 Ices owed.
- Bench (ESPN slot 20) and IR (slot 21) are ignored.
- Player/lineup penalties are due on the **Sunday date of the following NFL week**.
- Multiple violations stack independently.
- The public dashboard is read-only. Only the commissioner can sync or change completion status.

> The app tracks the number of Ices owed and completion status only; it does not include drinking-speed timers or other consumption mechanics.

## 1. Create Supabase

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Paste the contents of `supabase/schema.sql` and run it.
4. In **Project Settings -> API**, copy:
   - Project URL
   - Secret key (`sb_secret_...`)

The secret key is server-only. Never expose it in browser code or commit it to Git.

## 2. Configure locally

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required values:

```text
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=...
CRON_SECRET=...
```

`ESPN_LEAGUE_ID=666066604` and `ESPN_SEASON=2026` are already set for this league.

Generate random secrets with a password manager or, on macOS/Linux:

```bash
openssl rand -hex 32
```

## 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Then visit `http://localhost:3000/admin`, log in with `ADMIN_PASSWORD`, and click **Sync ESPN now**.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel choose **Add New -> Project**, import the repository, and let it detect Next.js.
3. Add the same environment variables from `.env.local` under **Project -> Settings -> Environment Variables**.
4. Deploy.
5. Visit `/admin` on the production URL and run **Sync ESPN now** once.

`vercel.json` registers a daily sync at `12:00 UTC`. On Vercel Hobby, cron jobs can run once per day and Vercel may invoke them at any point within the configured hour. That is fine here because finalized fantasy-week results only need a daily refresh. The commissioner button is available for immediate manual refreshes.

## ESPN/NFL data sources

The app reads the public ESPN Fantasy v3 endpoint for the league and uses:

- `mTeam`
- `mSettings`
- `mStatus`
- `mMatchupScore`
- `mBoxscore`

For deadlines it reads ESPN's public NFL scoreboard endpoint and uses the first kickoff of the next NFL week plus the Sunday date in `America/New_York`.

ESPN does not publish this Fantasy API as a formally supported developer API, so its response shape can change. The parser is isolated in `lib/espn.ts` and `lib/penalties.ts` so future repairs are localized.

Recent finalized weeks are reconciled on later syncs, so an ESPN stat correction can remove or update a previously generated obligation without duplicating records.

## Rule assumptions you can change

### Sunday penalty deadline

Your rule specifies Sunday of the following week but not a time. The app intentionally stores this as a **date**, not a time. It becomes overdue after that Sunday has passed in the league timezone.

### Low-score ties

Every team tied for the exact lowest score gets a recap obligation. If your league has a different tiebreaker, change the `lowScorers` selection in `lib/penalties.ts`.

### 0-point players

Every starter with an ESPN-applied weekly score of exactly `0.00` creates a 1-unit obligation, including a starter who never entered the game. Bench and IR players are ignored.

### Empty lineup spots

The app compares ESPN's `settings.rosterSettings.lineupSlotCounts` against the historical box-score lineup. It does not hard-code QB/RB/WR/FLEX counts, so your league can change its roster settings without changing code.

## Reusing in 2027

Change only:

```text
ESPN_SEASON=2027
```

The database keeps 2026 history because `season` is part of every obligation and every unique source key.

## Recap video uploads

The video-enabled version adds a `/recaps` archive and private per-obligation submission links.

For an existing database:

1. Run `supabase/recap-videos-migration.sql` once in Supabase SQL Editor.
2. In Supabase Storage, create a public bucket named exactly `recap-videos`.
3. Set the bucket file-size limit to **50 MB** and restrict it to video MIME types (`video/mp4`, `video/quicktime`, `video/webm`).
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.local` and Vercel. The publishable key is safe for browser use; never expose `SUPABASE_SECRET_KEY`.
5. From `/admin`, click **Create upload link** for a weekly recap and send that private link to the recap loser.
6. The submission page recommends **Record recap**. It requests the front camera at up to 720p/30 fps, targets about 2 Mbps video + 96 kbps audio, and automatically stops at 2:00 or early if the file approaches the free storage limit.
7. The loser can preview and re-record before submitting. Existing MP4/MOV/WebM files up to 48 MB remain available as a fallback.
8. A successful website upload automatically marks the recap complete and adds it to `/recaps`.

The upload itself goes directly from the browser to Supabase using a short-lived signed upload token. The large video file never passes through a Vercel function. Camera recording works on secure contexts such as `https://...` production URLs and on `localhost`; the browser will ask the user for camera and microphone permission.
