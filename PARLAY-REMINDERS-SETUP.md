# Parlay reminders, history and Venmo tracking – installation guide

## What's included

- Sunday submission cutoff at **11:55 AM America/Chicago** (automatically CDT/CST).
- Web Push opt-in on `/parlay`, associated with one fantasy **team** on an honor system; can subscribe more than one device per team.
- Reminders for missing submissions: **Thursday, Friday, Saturday 8 PM; Sunday 9 AM and 11:30 AM CT**. Last reminder says **URGENT** and uses the Web Push `high` priority header. It does **not** bypass DND/Focus or guarantee instant delivery.
- A $1 Venmo confirmation modal before every save/change. Enter a name, confirm payment, then submit. This is an attestation, **not** receipt verification.
- `/parlay/history` displays prior legs (final submission for each team/week), submitter and **manual** result. `/admin` handles grading and verified $1 payments. Withdrawals retain payment records; no withdrawn bet appears on the public history screen.

## 1. Supabase migration – run before deploying

Open the existing Supabase project's SQL Editor and run:

`supabase/parlay-reminders-history-migration.sql`

This adds columns to `parlay_submissions`, creates private `parlay_push_subscriptions` and `parlay_reminder_deliveries` tables, and preserves historical rows. Existing 2026 picks display as pending; they won't have a member name or payment attestation until submitted under the new form. Existing records can still be graded and marked paid in admin.

## 2. Generate VAPID keys once

With Node.js installed, run this in your local terminal (or use an online Node execution environment **you trust**). No npm packages are needed:

```bash
node -e "const e=require('node:crypto').createECDH('prime256v1');e.generateKeys();console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY='+e.getPublicKey().toString('base64url'));console.log('VAPID_PRIVATE_KEY='+e.getPrivateKey().toString('base64url'))"
```

Add the following environment variables to **Vercel → Project → Settings → Environment Variables** (Production), then redeploy:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: output of the generation command. Public; exposed to browser.
- `VAPID_PRIVATE_KEY`: output of the command. **Secret; never commit to Git.**
- `VAPID_SUBJECT`: your email in format `mailto:you@example.com`.
- `NEXT_PUBLIC_VENMO_URL`: optional, e.g. `https://venmo.com/u/YOUR_USERNAME`. Leave blank until you know the correct Venmo handle.

**Keep both VAPID keys fixed** across deployments or existing devices will have to subscribe again. Never share the private key with users.

## 3. Schedule reliably, including DST

`/api/cron/parlay-reminders` is secured by your existing `CRON_SECRET`. It checks the actual Chicago time, whether each team has submitted, and per-device delivery logs. Running outside the five windows does not send anything. Duplicated triggers in the same window do not re-send.

The included `.github/workflows/parlay-reminders.yml` schedules the endpoint using **GitHub Actions**, which can work with a Vercel Hobby deployment without requiring a Vercel Pro subscription. GitHub Actions scheduled runs can be delayed or occasionally not run; the website will not automatically send missed reminders after their configured windows. The workflow includes a manual run option for testing (outside the active window it sends nothing).

In your GitHub repository, visit **Settings → Secrets and variables → Actions** and add **repository secrets**:

- `CRON_SECRET`: the **exact same** value as your Vercel production `CRON_SECRET`.
- `PARLAY_REMINDER_URL`: the entire production HTTPS URL, for example `https://your-site.vercel.app/api/cron/parlay-reminders`.

Push the updated repository to the default branch and enable GitHub Actions if necessary. Its workflow already accounts for both CDT and CST: the server confirms local date/time before sending, so only the correct UTC occurrence executes a reminder. Delivery logs prevent duplicated notifications.

**Scheduling caveat:** GitHub Actions timing is not guaranteed to the minute; a delayed job may miss the 11:30–11:54 AM final-warning window. If you require high-reliability, precise Sunday alerts, use a scheduler with time-zone-aware minute precision (e.g. Vercel Pro or a dedicated scheduling provider) to call the same endpoint. Vercel Hobby cron is only once daily per job and may run at any time within the selected hour, so it is not suitable for precise 11:30 AM reminders.

`vercel.json` still runs the existing Sunday lock snapshot jobs. They now target 16:55 and 17:55 UTC; only the applicable CDT/CST invocation locks, and the page also locks when first loaded after the deadline. **Server-side submission rejection at 11:55 AM remains independent of cron timing.**

## 4. Each member enables notifications once

Share the `/parlay` page with leaguemates. Each member chooses their team, then taps **Enable phone reminders**. Permission is required and each device subscribes independently. If they own multiple devices they must repeat on each one. Subscriptions remain active across fantasy weeks unless the browser clears its data or notifications are disabled.

**iPhone/iPad:** Open website in Safari, Share → **Add to Home Screen**, open the newly installed app, select fantasy team and tap **Enable phone reminders**. Web Push requires iOS/iPadOS 16.4+ and Home Screen installation. Supported Android browsers generally support Web Push from the browser. Only HTTPS production (or localhost for local testing) supports service workers and push.

The `/admin` page lists the number of registered devices per fantasy team so you can see who still needs to opt in; it does not display their private subscription keys.

## 5. Grading and payments

- Use `/admin` → **Weekly bets & $1 payments**. For each pick, choose `Hit`, `Miss`, `Push`, `Void`, or `Pending` and click Save.
- When a Venmo payment actually arrives, click **Mark $1 received**. Click **Verified · undo** if you need to correct it.
- The public `/parlay/history` page shows results, but doesn't expose the commissioner's payment verification information.
- Withdrawn bets retain their stored payment record for the week; re-submitting restores it. Member-entered names are self-reported, not identity authentication.

## 6. Test / rollout checklist

1. Take a Supabase backup, run the migration and deploy the updated code.
2. Open `/parlay` on desktop and confirm the displayed deadline is Sunday at 11:55 AM CT.
3. Select a team, choose a prop, and verify the $1 Venmo modal blocks submission until a name and attestation are provided.
4. Open `/admin` to verify the pick, member, payment confirmation and manual grading controls. Change to a new pick and verify the prior payment verification remains.
5. Register for notifications on a phone and confirm the device count rises in `/admin`; use **Send test push** for that team to confirm delivery before Sunday.
6. Use the scheduled workflow during an active reminder window for a test; verify a missing team receives its push and a submitted team does not. Delivery history is saved in `parlay_reminder_deliveries` (the admin page displays subscription counts, not full delivery logs).
7. Verify Sunday picks lock at 11:55 and no further submit/change/withdraw is accepted.

No actual push can be sent until Supabase, VAPID keys, a deployed domain, phone permission and the scheduled workflow are configured. No Venmo payments are actually transmitted or verified automatically.
