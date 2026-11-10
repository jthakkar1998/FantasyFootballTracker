# FFBall Phase 2 — Final Grading + Live Hit Pushes (combined rollout)

This is a **single combined replacement for the earlier Phase 2-only ZIP**. You have NOT yet deployed that earlier patch. **Use only the new `FantasyFootballTracker-Phase2-Grading-and-Live-Hits-CHANGED-FILES.zip`**. Each entry is a new/modified file at its relative GitHub repository path; no files from the already-working Phase 1 need to be deleted.

## Status and safety at the outset

- Phase 1 was verified: **Week 9: 9 picks / 9 primary 11:56 AM CT FanDuel lines / 0 missing / 0 fallback-only**.
- Phase 2 final grading uses the stored **primary** quote plus **final** ESPN NFL box-score statistics. It never uses ESPNs own fantasy power rankings or player fantasy-point projections for grading.
- New: live hit alerts check ESPN NFL box scores every **3 minutes** during **Sunday noon–Monday 3 AM America/Chicago**. **Over/Yes** may notify provisionally during play; **Under/No** only after the game is officially final and stats unambiguous. Neither feature calls SportsGameOdds again.
- Live notifications target **push subscriptions registered for the submitting fantasy team**, not every member of the league. One accepted push per pick per device; at most three attempts if the push service fails. Browser notification permissions remain under user control.
- **Independent kill switches:** `PARLAY_AUTO_GRADING_ENABLED` gates writing actual grades; `PARLAY_LIVE_HITS_ENABLED` gates sending hit pushes. **Both start off.** Read-only previews are allowed with both off.
- Manual/off-app bets, all historical results and $1 payments, commissioner overrides, and existing reminders/snapshot jobs are unaffected.
- To avoid accidental historical alerts, live pushes start at **Week 10** (`PARLAY_LIVE_HITS_MIN_WEEK=10`). Earlier picks intentionally have no new pro-team mapping and are never notified retroactively. The grading preview can still process **Week 9**.

## A. Run both migrations BEFORE deploying the changed files

1. **Supabase → SQL Editor → New Query**: run every line of `supabase/parlay-auto-grading-migration.sql`.
2. **New Query**: run every line of `supabase/parlay-live-hit-migration.sql`.

The first migration adds protected final-grade auditing, old-grade `manual` tags, and private grading dispatch. The second **adds** nullable `pro_team_id` on new website picks, live-delivery/audit tables, an atomic duplicate-resistant push claim, and private live Cron dispatch. Neither migration itself activates or sends anything, changes historical wagers/payment values, or modifies existing Cron jobs.

**Do not run either `*-enable.sql` yet.** These migrations are additive and safe to rerun if needed.

## B. Copy the combined changed-files ZIP into your GitHub `main`

Unzip `FantasyFootballTracker-Phase2-Grading-and-Live-Hits-CHANGED-FILES.zip`. In GitHub or github.dev, upload each file/folder to the same relative path in your existing repository. Commit to `main` and verify the Vercel **Production** deployment is healthy. **Do not overwrite the entire repository; this ZIP contains changed files only.**

Leave your existing Vercel variables as they are, especially `PARLAY_SNAPSHOTS_ENABLED=true`, `PARLAY_REMINDER_CRON_SECRET`, Supabase credentials, and VAPID keys.

Add in **Vercel → Settings → Environment Variables → Production** (or leave defaults, where shown):

```
PARLAY_AUTO_GRADING_ENABLED=false
PARLAY_AUTO_GRADING_MIN_WEEK=9
PARLAY_LIVE_HITS_ENABLED=false
PARLAY_LIVE_HITS_MIN_WEEK=10
```

After adding variables, **redeploy Production**. Neither final grading writes nor live pushes is enabled at this point.

### What changed

- Phase 2 grading: `lib/parlay-grade-core.ts`, `lib/parlay-auto-grade.ts`, `lib/nfl.ts`, Commissioner preview/apply routes & component, and related SQL.
- Live push: `lib/parlay-live-hit-core.ts`, `lib/parlay-live-hits.ts`, `components/ParlayLiveHitReport.tsx`, protected `/api/cron/parlay-live-hits` and Commissioner read-only preview routes, plus new SQL.
- Website submission: `app/api/parlay/submit/route.ts` saves ESPN's verified **pro team ID** on NEW picks; updated `lib/parlay-db.ts` and `lib/parlay-types.ts`. Historical picks are not changed.
- Both features reuse `lib/web-push.ts`, `parlay_push_subscriptions`, and Supabase Vault's existing `ffball_reminder_url` and `ffball_reminder_token`. **No additional third-party subscription or API key required.**

## C. Read-only Week 9 final-grading verification

Go to **Commissioner → Phase 2 · Automatic grading preview**, choose **Week 9** and click **Preview grades (read-only)**. You should see up to 9 website picks with saved 11:56 FanDuel lines and final ESPN NFL box-score numbers. **Verify each actual player/stat/result carefully**. If it says Review, missing, wrong athlete or unsupported stat, leave that pick Pending and handle manually. An `eligibility_at_lock` not confirmed issue can be checked with:

```sql
SELECT team_name, player_name, eligibility_at_lock,
       eligibility_reason, result_status, grade_source
FROM public.parlay_submissions
WHERE season = 2026 AND week = 9 AND withdrawn_at IS NULL
ORDER BY team_name;
```

Connection-only Supabase test (read-only for picks/payments):

```sql
SELECT ffball_private.ffball_test_grade_connection(9) AS request_id;
```

Then verify HTTP (a returned request_id alone is NOT a success):

```sql
SELECT d.queued_at, d.request_id, r.status_code, r.content
FROM public.parlay_auto_grade_dispatches d
LEFT JOIN net._http_response r ON r.id = d.request_id
WHERE d.is_test = true ORDER BY d.queued_at DESC LIMIT 5;
```

Look for `status_code=200`, JSON `ok:true`, `status:"preview"`. `401` means token mismatch, `404` route missing, `500` review server logs/returned content. This preview does not send pushes or change result/payment fields.

## D. Check the new live-alert connection and preview (still OFF)

Run the following in **Supabase SQL Editor**:

```sql
SELECT ffball_private.ffball_test_live_hit_connection() AS request_id;
```

Then inspect the **actual HTTP response**:

```sql
SELECT d.queued_at, d.request_id, r.status_code, r.content
FROM public.parlay_live_hit_dispatches d
LEFT JOIN net._http_response r ON r.id = d.request_id
WHERE d.is_test = true ORDER BY d.queued_at DESC LIMIT 5;
```

Expect `200`, `ok:true`. Outside Sunday noon–Monday 3 AM Central, the **correct response is `status:"no_window"`**; this verifies auth/route only. It does **not** prove live ESPN stat retrieval or push delivery yet.

On your Commissioner page, you'll also find **Phase 2 · Live hit notifications → Preview live alerts (read-only)**. During a valid Sunday live window after 11:56 snapshots, it shows eligible picks, ESPN stats, and whether a pick is currently hitting. Preview **never pushes, grades, or records a delivery**. `no_window` before Sunday is expected.

For the first live trial on **Sunday, November 15, 2026 (Week 10)**, check that at least one team entered a website pick before lock, has a primary 11:56 snapshot, and has a registered push device. Inspect the preview when that player's game starts. Confirm the stat value and side match the actual NFL data. If a player ID or game mapping fails, keep sending OFF and investigate.

## E. Enable live hit notifications, *after verifying a Sunday live preview*

1. In Vercel **Production**, set `PARLAY_LIVE_HITS_ENABLED=true` and **redeploy**.
2. Supabase SQL Editor: run `supabase/parlay-live-hit-enable.sql`.
3. Verify the separate job (existing jobs will remain):

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'ffball-parlay-live-hits';
```

Expect one active job with `*/3 * * * 0,1`. The DB+server *both* check local Central time so the UTC schedule never sends outside Sunday noon–Monday 3 AM CT. A newly deployed flag does not retroactively alert Week 9.

Check actual delivery history on Sunday:

```sql
SELECT season, week, team_id, submission_id, status,
       attempt_count, observed_value, frozen_line, game_final,
       attempted_at, sent_at, last_http_status, last_error
FROM public.parlay_live_hit_deliveries
ORDER BY attempted_at DESC LIMIT 30;
```

A `sent` row and 2xx HTTP means the **push provider accepted the notification**, not a guarantee it appeared on the phone. If you want to test your push setup independently, use the Commissioner page's existing **Send test push** on the member's team card.

**Push behavior:**
- Over 5.5 receptions: when ESPN first shows 6+, a provisional hit push is sent once per eligible device.
- Under 90.5 rushing yards: never alert before game final; if confirmed 90 or fewer in a final box score, send a hit push.
- Anytime TD Yes: a clearly documented rushing/receiving TD may trigger a provisional hit. A zero cannot establish an anytime-TD No/Miss due to possible returns/fumble TDs; ambiguous markets go to review.
- Missing/DNP stats, unsupported markets, missing primary snapshot, missing team identification, or failed eligibility: **no hit notification**. A live hit may be overturned by later official stat corrections; notification wording always makes that distinction.

## F. Enable actual automatic grading *independently* (only after checking final Week 9 preview)

1. Set `PARLAY_AUTO_GRADING_ENABLED=true` in Vercel Production; redeploy.
2. On Commissioner → **Phase 2 · Automatic grading preview** choose Week 9, run the read-only preview again, and verify stats. A Commissioner-confirmed **Apply verified grades for Week 9** action appears for supported pending records. It changes only verified pending website grades; payment/off-app/manual results stay untouched.
3. Run `supabase/parlay-auto-grading-enable.sql` in Supabase SQL Editor for future Monday/Tuesday **9:15 and 9:45 AM CT** grading runs.
4. Verify:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job WHERE jobname = 'ffball-parlay-auto-grade';
```

Review results:

```sql
SELECT started_at, season, week, run_source, status,
       ready, review, already_graded, applied, errors
FROM public.parlay_auto_grade_runs
ORDER BY started_at DESC LIMIT 20;
```

Final auto grading **never** treats a live alert as a final Hit. It rereads final ESPN NFL stats and the primary Sunday line independently. Commissioner overrides remain protected. Backup-only snapshots, unsupported / ambiguous / DNP / unavailable stats stay in Review rather than guessing.

## Emergency stops

Stop live pushes without interrupting grading/reminders/snapshots: set `PARLAY_LIVE_HITS_ENABLED=false` in Vercel Production and redeploy; run `supabase/parlay-live-hit-disable.sql`.

Stop grading writes without interrupting pushes/reminders/snapshots: set `PARLAY_AUTO_GRADING_ENABLED=false` and redeploy; run `supabase/parlay-auto-grading-disable.sql`.

**Do not delete either new database table set:** keeping the audit history helps determine what happened. Neither emergency-stop script modifies historical bets, grades, or $1 payment records.

## What was and wasn't verified locally

The 11 focused grading/live-decision unit tests (including DST, primary-only lines, under-final-only, touchdown/missing-stat review, manual-grade protection) passed. The TypeScript source also received a syntax/transpilation check. I could not install this repository's Next.js dependencies in the local sandbox, so the complete `npm run build` and a live Supabase/Vercel/ESPN/push-service integration test **have not been performed here**. The Week 9 grading preview and Week 10 live preview are required before either production send or grade-write flag is enabled.
