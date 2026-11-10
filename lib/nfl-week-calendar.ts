/**
 * Published NFL regular-season Sunday dates. This is deliberately season-specific:
 * never silently extrapolate another season's schedule or its league deadlines.
 * Source: NFL Football Operations, 2026 regular-season schedule.
 */
const VERIFIED_WEEK_ONE_SUNDAYS: Record<number, string> = {
  2026: "2026-09-13"
};

export function verifiedNflSundayDate(season: number, week: number): string | null {
  if (!Number.isInteger(week) || week < 1 || week > 18) return null;
  const first = VERIFIED_WEEK_ONE_SUNDAYS[season];
  if (!first) return null;
  const start = Date.parse(`${first}T12:00:00.000Z`);
  return new Date(start + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
}
