# Phase 2 Commissioner UI spacing fix

This is a **four-file fix** intended for the existing feature branch containing
Phase 2 automatic grading + live hit notifications. You do **not** need to
reinstall Phase 2 or rerun Supabase migrations.

## Files to replace
- `app/globals.css` — padding, spacing, correct column widths for both tables,
  horizontal scrolling on small screens, result-pill colors.
- `components/ParlayGradingReport.tsx` — six-column table widths and red MISS/
  green HIT/amber PUSH results. No grading calculations changed.
- `components/ParlayLiveHitReport.tsx` — five-column table widths and clear
  `no_window`/`empty` messages instead of misleading 0 eligible-pick counters.
- `lib/parlay-live-hits.ts` — clarify that a successful outside-window preview
  request does **not** test NFL data or push subscriptions. No live alert
  decisions or sending behavior changed.

## Install
1. Stay on your feature branch, e.g. `feature/parlay-phase2-grading-live-hits`.
2. Extract this ZIP at the repository root, overwriting the four paths above.
3. Commit the four changes and let Vercel build a fresh **Preview** deployment.
4. Reload Commissioner > Phase 2; preview Week 9 grades again. Six columns
   should display at normal row height. On narrow screens, scroll the table
   horizontally rather than shrinking the Explanation text into a sliver.
5. Keep `PARLAY_AUTO_GRADING_ENABLED=false` and
   `PARLAY_LIVE_HITS_ENABLED=false` until grading and push checks pass.

## Interpretation of existing screenshots
- Week 9 grading preview: 9 website picks, 8 eligible to auto-grade,
  1 needs manual review. These are PROPOSED results, not applied grades.
- Two visible spot-checks are arithmetically correct: Over 5.5 receptions
  with 5 = MISS; Under 90.5 rushing yards with 102 = MISS.
- Live-hit preview outside Sunday noon to Monday 3:00 AM Central is
  intentionally inactive. A returned `no_window` result confirms only that
  the preview endpoint responded, not ESPN access or push delivery.
- Test live-hit preview Sunday after the Week 10 primary snapshots exist.
  Keep it read-only; check eligible picks, matching stats and registered
  devices before enabling pushes.

## QA done
- Reviewed original Phase 2 TSX/CSS and identified the inherited widths
  reserving 100% for 5 columns while grading had 6.
- WeasyPrint layout check of a representative 6-column table: typical
  data rows approximately 65–79 px, instead of the screenshot's oversized rows.
- TypeScript transpilation syntax check for changed TS/TSX passed.
- Existing 11 core grading/live-hit tests passed via TypeScript transpilation
  and Node's built-in test runner.
- CSS parsed with zero top-level errors.

A full Next.js production build and live Supabase/ESPN tests were not run
here. The actual deployed preview remains the final integration check.
