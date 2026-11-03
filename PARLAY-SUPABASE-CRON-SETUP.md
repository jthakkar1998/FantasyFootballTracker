# Switch missing-pick reminders to Supabase Cron

**Scope:** Thursday/Friday/Saturday 8 PM Central, Sunday 9 AM Central, Sunday 11:30 AM Central urgent. The Sunday pick deadline remains **11:55 AM Central**. This replaces only the GitHub Actions *parlay reminder* schedule. The existing Vercel ESPN sync and parlay-lock cron jobs stay in place. No automatic bet grading or Sunday odds snapshots are included.

## File changes

Modify these existing files:

- `app/admin/page.tsx` — recent reminder-run diagnostics (commissioner only).
- `app/api/cron/parlay-reminders/route.ts` — Supabase-only authentication, run logging, safe dry run.
- `app/globals.css` — diagnostics table styling.
- `lib/parlay-notifications.ts` — safe retries for unsuccessful pushes and dry-run eligibility preview.

Add these files:

- `lib/parlay-reminder-diagnostics.ts`
- `supabase/parlay-supabase-cron-migration.sql`
- `supabase/parlay-supabase-cron-enable.sql`
- `supabase/parlay-supabase-cron-disable.sql`
- `tests/parlay-supabase-cron.test.ts`
- This setup guide.

**Delete exactly one existing file on your feature branch:**

- `.github/workflows/parlay-reminders.yml`

Do **not** delete the `.github/workflows` folder or other workflows.

## Deploy in this order (don't enable the schedule early)

### 1. Enable Supabase extensions

In Supabase Dashboard → Database → Extensions / Integrations, ensure **pg_cron**, **pg_net**, and **Vault** are enabled. These are available on the Free plan. Only enable missing extensions; do not disable existing ones.

### 2. Run the additive schema migration

Supabase → SQL Editor → New Query: paste the *complete contents* of `supabase/parlay-supabase-cron-migration.sql` and run it. It adds delivery retry fields, private dispatch helpers, and two diagnostic tables. Existing picks, Venmo verification, device subscriptions, and past reminder delivery rows remain intact.

**Do not run `parlay-supabase-cron-enable.sql` yet.**

### 3. Create a dedicated Vercel environment secret

Generate a new high-entropy token (you may reuse the offline random-token generator from the previous CRON_SECRET rotation, but generate a **different** value). In Vercel → Project → Settings → Environment Variables, add:

- Name: `PARLAY_REMINDER_CRON_SECRET`
- Type: **Secret**
- Environment: **Production**
- Value: your newly generated token.

Leave the existing `CRON_SECRET` **unchanged**, since it is used by other Vercel scheduled routes.

### 4. Add two Supabase Vault secrets

Supabase → Vault → New secret (menu location varies). Create exactly these two secrets:

1. Name `ffball_reminder_url`  
   Value: `https://YOUR-PRODUCTION-DOMAIN/api/cron/parlay-reminders`  
   Use the real HTTPS domain, with no trailing slash, query string, or preview URL.
2. Name `ffball_reminder_token`  
   Value: **exactly the same** newly generated token as `PARLAY_REMINDER_CRON_SECRET` in Vercel.

Do **not** paste the token into a SQL file or GitHub. It is read at execution time from Supabase Vault. This token only authorizes the reminder route; unlike the general `CRON_SECRET`, it cannot call your existing ESPN sync/lock routes. Note that `pg_net` temporarily stores outbound Authorization headers in its internal database queue while requests are pending, so this dedicated minimal-privilege token is intentional.

### 5. Create a feature branch and upload the patch

In your GitHub website (no desktop app needed):

1. Create a new branch from the latest `main`, e.g. `switch-parlay-reminders-to-supabase`.
2. Open github.dev by pressing `.` from your branch.
3. Place all changed/new files at the exact paths listed above (the ZIP preserves directories).
4. Find `.github/workflows/parlay-reminders.yml`, right-click **Delete** (delete the **file only**).
5. Commit/push the changes and open a pull request into `main`.
6. Confirm Vercel's preview build passes; then merge the PR.
7. In Vercel → Deployments, verify the new `main` Production deployment is **Ready**.

The prior GitHub Actions schedule is now absent from `main`, but Supabase's replacement schedule is not yet active.

### 6. Test Supabase → Vercel without sending notifications

Supabase SQL Editor — run:

```sql
select ffball_private.ffball_test_reminder_connection() as request_id;
```

That queues an **authenticated, read-only dry run**. It does not send pushes or claim deliveries, even if you run it during a real reminder window. You should receive a numeric request ID.

Check the HTTP response a few seconds later:

```sql
select d.queued_at, d.is_test, r.status_code, r.content, r.error_msg
from public.parlay_reminder_dispatches d
left join net._http_response r on r.id = d.request_id
order by d.queued_at desc
limit 10;
```

For a successful test, `is_test = true`, HTTP `200`, and the response contains `"dryRun":true` with `eligibleDevices`, `missingTeams`, etc. If the HTTP response has not arrived yet, retry the *SELECT*, not the dispatch.

You should also see a new **preview** row on your website's Commissioner → **Automated reminder diagnostics**. This proves Supabase Vault, pg_net, Vercel authentication, and the real missing-pick lookup work together without sending messages.

Troubleshooting:

- **401:** The Vercel `PARLAY_REMINDER_CRON_SECRET` and Vault `ffball_reminder_token` do not match, or Vercel has not redeployed with the new secret.
- **404:** Vault's URL points to the wrong domain/path.
- **500:** Look at `error` in the response and Vercel runtime logs. Missing schema or ESPN API errors are possible.
- **No HTTP result:** Supabase pg_net may be disabled or the network request may still be queued. Check Supabase Logs and `net._http_response`.
- **`eligibleDevices:0`:** There may be no missing-pick teams with a registered device at that moment; no push is expected.

### 7. Enable Supabase Cron only after the test succeeds

Supabase SQL Editor → New Query: paste the complete `supabase/parlay-supabase-cron-enable.sql` and run it. Three **named** jobs are created. They check at five-minute intervals during the intended windows, with guards based on actual `America/Chicago` local time. The extra UTC candidate hours are deliberate to handle CST/CDT automatically.

Verify jobs exist:

```sql
select jobname, schedule, active
from cron.job
where jobname like 'ffball-parlay-%'
order by jobname;
```

All three should show `active=true`.

### 8. Monitor the first live window

Supabase → Integrations → Cron → History, and the Commissioner diagnostics section, will show recent runs. SQL for database-level history:

```sql
select j.jobname, d.status, d.start_time, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname like 'ffball-parlay-%'
order by d.start_time desc
limit 30;
```

A cron SQL job may say `succeeded` even if the **asynchronous HTTP request fails**. To verify end-to-end, use the `net._http_response` query above and the Commissioner **Automated reminder diagnostics** section. A row marked `success` with `sent > 0` means the push service accepted one or more messages, and a phone should still be checked for actual delivery.

## Retry and duplication policy

- One successful reminder **per registered device, fantasy week, and reminder slot**.
- A failure may retry at the next five-minute check, up to **3 total attempts**. Stuck attempts are eligible again after 2 minutes.
- Invalid/expired push subscriptions (HTTP 404/410) are removed.
- Existing website picks and commissioner-recorded off-app picks are skipped.
- All jobs stop sending after Sunday's 11:55 AM Central deadline.
- The dry-run test never sends pushes, claims a slot, or updates betting records.

## Rollback / pause

To immediately disable the new Supabase schedule, run `supabase/parlay-supabase-cron-disable.sql`. This stops only the three named reminder jobs; it does not delete historical data or affect Vercel's separate ESPN/parlay-lock schedules.

## Historical data guarantee and limitations

All changes are additive. Previously-entered Weeks 1–7 bets, results, payment confirmations, subscriptions, punishments, and recap videos are unchanged. No changes to SportsGameOdds, Sunday snapshots, or automatic grading are included.

Local test coverage checks CDT/CST schedules, 11:55 cutoff, dry-run isolation, dedicated auth, and retry safeguards. A full Next.js build, real PostgreSQL migration, and live reminder delivery still require verification in your connected Vercel/Supabase project.
