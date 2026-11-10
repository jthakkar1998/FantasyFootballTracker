# Fantasy Punishment Board — NFL Schedule Reliability Upgrade

## Use this package INSTEAD of the earlier Parlay 403 hotfix

This is a changed-files-only update based on the latest Phase 2 + Commissioner UI-fixed source. It does **not** change any of your grading, push, snapshot, payment, or SQL schemas.

## What's improved

1. **Parlay deadline without ESPN's NFL schedule:** For 2026, the verified NFL Week 1 Sunday (September 13) and seven-day week spacing provide the correct Chicago Sunday for each NFL week. The existing 11:55 AM Central deadline logic stays in place. The Parlay page still needs ESPN's **fantasy league roster** data to verify each opponent's starters; it no longer needs ESPN's separate NFL scoreboard just to display the deadline.
2. **Prop selection without ESPN's NFL schedule:** Uses the existing SportsGameOdds Sunday event feed, matches the player's ESPN fantasy `proTeamId` to a verified NFL team identity, checks the event's Chicago-local Sunday, requires one unique game and the exact named player, and verifies player-team IDs when SportsGameOdds supplies them. If verification fails, it refuses to offer a prop rather than guessing.
3. **Persistent NFL schedule cache:** The NFL scoreboard lookup used by automatic grading, live hit monitoring, and recap sync now reads/writes the existing Supabase `parlay_odds_cache` table with keys like `espn:nfl:schedule:v2:2026:w10`. All Vercel instances share this cache. No new migration.
4. **Validated stale fallback:** When ESPN responds 403/429/times out, reuse a recently cached NFL schedule only if each game has a valid ESPN event ID, kickoff timestamp, and two distinct NFL teams. Existing grading/live-hit matching still checks saved kickoff and pro-team IDs; uncertain results require review instead of being auto-graded or pushed.
5. **SportsGameOdds Sunday slate fallback:** The separate SportsGameOdds event lookup also reuses a previously cached slate for up to 6 hours after a temporary failure; live player props are still fetched/validated by exact player+event.

### Cache time policy

| Schedule timing | Treat cache as fresh for | Maximum stale reuse when ESPN fails |
|---|---:|---:|
| Upcoming (more than 2 days before Sunday) | 12 hours | 7 days |
| Game window (Sunday +/- approximately 2 days) | 1 hour | 2 days |
| Historical (more than 3 days after Sunday) | 30 days | 45 days |

A cold-cache ESPN failure may still delay grading/alerts; **the upgrade never guesses ESPN game IDs**. ESPN's final player-stat endpoint and ESPN fantasy league endpoint are still used where needed. Future seasons not explicitly on the verified Sunday calendar fall back to the cached ESPN NFL lookup until a new season anchor is added.

## Upload / deploy — no database changes

1. **Do not upload** the older `FFBall-Parlay-403-Schedule-Hotfix-4-Files.zip`. This package supersedes it. Also do not overwrite any more recent Commissioner UI layout changes.
2. In GitHub, create a branch from your **latest `main`**, such as `fix/espn-schedule-reliability`.
3. Download and unzip `FFBall-ESPN-Schedule-Reliability-CHANGED-FILES.zip`.
4. Upload/replace all files under `lib/` and add `tests/nfl-reliability.test.ts`, **preserving paths**. There are 8 changed/new code files total. No `.env` file, `supabase/` SQL, migrations, or config changes are needed.
5. Commit to the new branch and open the Vercel **Preview** deployment. Keep Preview grading and push flags OFF, especially if Preview shares your production Supabase database.
6. Verify in Preview:
   - `/parlay` opens; the deadline is **Sun Nov 15, 2026 at 11:55 AM Central** for Week 10.
   - Existing submitted picks, Sunday locks, History, and Commissioner pages still render.
   - If props are currently available, select a legitimate opponent starter and check that the displayed NFL matchup corresponds to their team and a Sunday game. Do **not** submit a live production bet merely to test the preview.
   - Week 9 read-only grade preview still matches the same results/previous grading status. For picks already graded in production, it is normal to see them as **already graded** rather than **ready**.
   - Check Vercel Logs if you encounter any error. Entries prefixed `[nfl-schedule]` report a failed refresh or validated stale-cache use. `[sgo-schedule]` denotes SportsGameOdds cache fallback.
7. Once the Preview build and these checks pass, merge the branch into `main` and verify the production Parlay page. Do not enable new Cron jobs or live alerts solely because this patch was deployed.

## Validation performed

- 18 focused tests passed (7 new NFL calendar/team matching/cache tests + 11 existing auto-grade/live-hit tests).
- Strict TypeScript checking passed for the new pure modules and their direct dependencies.
- TypeScript syntax checks passed for the changed integration files.
- **Not yet validated:** an end-to-end build with downloaded Next.js dependencies (the local npm install failed), live Vercel API calls, and live SportGameOdds Sunday matchups. The Vercel Preview deployment is required to validate those. Do not enable new automatic writes or pushes until its real-data checks pass.

## Operational notes

- There is no new ESPN API key and no additional SportsGameOdds entitlement requested.
- NFL calendar anchor for 2026 was checked against NFL Football Operations' published regular-season schedule.
- SportsGameOdds `startsAfter`/`startsBefore` event filters are documented in their v2 `GET /events` API.
- The `parlay_odds_cache` table must exist and allow your server-side service role to read/write it, as it already does for the current odds flow.
- Existing grading and push feature flags do not need to change as part of this reliability deployment.
