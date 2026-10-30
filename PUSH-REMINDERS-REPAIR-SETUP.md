# Push reminders repair — production patch

This patch was built against `FantasyFootballTracker-main (1).zip` (October 26, 2026), **without** the optional automatic parlay grading / line snapshot Phase 1 feature. It does not change odds, parlay picks, punishment, historical grades, or Venmo data.

## Problems fixed

1. `.github/workflows/parlay-reminders.yml` stored GitHub secret expressions as literal HTML entities (`$&#123;&#123; ... &#125;&#125;`). These were not evaluated by GitHub Actions, so the script used the wrong URL and `CRON_SECRET`. The workflow now uses actual `${{ secrets.* }}` expressions and prints errors and response counts to the Actions run log.
2. `components/ParlayNotifications.tsx` always reset its `enabled` state to false and never loaded the saved browser/Supabase registration when a fantasy team was selected. Returning members will now see **Enabled on this device** for the team registered with their existing push subscription. Other-team and unlinked subscriptions can be re-linked from the interface.
3. The reminder checker ignored bets marked **submitted outside app** by the commissioner. It will now count those as submitted too, so those teams stop receiving missing-pick reminders.

## Apply safely using GitHub website (no desktop app)

1. From your current **main** branch, create `fix-parlay-push-reminders`.
2. Press `.` to open github.dev. Copy the files from this ZIP into the **exact paths** shown below. The `.github` directory starts with a dot and can be skipped by some Windows/browser upload flows; use github.dev for it.
3. Commit and push on the feature branch, then create a pull request to main. Expect **4 modified files and 1 new test file and 1 new guide** (six files total). Confirm Vercel preview check passes.
4. Merge and wait for Vercel **Production Ready**. Do not rerun SQL migrations, rotate secrets, or change VAPID keys. The existing environment variables and Supabase tables are reused.

Changed files:

- `.github/workflows/parlay-reminders.yml`
- `app/api/parlay/notifications/route.ts`
- `components/ParlayNotifications.tsx`
- `lib/parlay-notifications.ts`
- `tests/parlay-notification-repair.test.ts` (new)
- `PUSH-REMINDERS-REPAIR-SETUP.md` (new)

## Verify the actual failure from Thursday Oct 29, 2026

On GitHub open **Actions → Parlay missing-pick reminders**, then view the run at approximately **Friday Oct 30, 01:00 UTC**, corresponding to **Thursday Oct 29, 8:00 PM CDT**. The prior broken workflow likely failed with a malformed URL or credentials error. If there is no run, check whether Actions are enabled for the repository and whether scheduled workflows have been disabled.

After deployment, open **Commissioner**. For each team, check the displayed subscribed-phone count. Choose a team with >0 phones and click **Send test push**. This bypasses the reminder schedule and lets you confirm actual delivery to a phone. The site reporting a push-service acceptance does not guarantee that the phone displayed the notification. If a team shows zero devices, ask a member to select their team on the Parlay page and enable notifications using the correct browser or iPhone Home Screen app.

You can also inspect Supabase using these read-only SQL queries:

```sql
select team_id, count(*) as registered_devices, max(updated_at) as last_registration
from public.parlay_push_subscriptions
 group by team_id order by team_id;

select season, week, reminder_slot, status,
       count(*) as delivery_attempts, max(attempted_at) as last_attempt
from public.parlay_reminder_deliveries
where season = 2026
 group by season, week, reminder_slot, status
order by week desc, reminder_slot, status;
```

Do not share subscription endpoint URLs, keys, VAPID secrets or `CRON_SECRET` in screenshots or chat.

## Scheduled test

When GitHub Actions runs **outside** the Thursday–Sunday reminder windows, the endpoint will return `slot: null`, `sent: 0`, with a reason. That is expected. Check a real scheduled run during the window for `sent`/`skipped`/`failed` counts. The 8 PM Thursday job occurs at 01:00 UTC on Friday while Chicago is on daylight time. GitHub Actions can delay or omit scheduled runs; the app cannot guarantee push delivery timing.
