import { leagueConfig } from "./config";
import { getCurrentParlayContext } from "./parlay";
import { listSnapshotPicks, listSnapshots, saveSnapshotRun, storeSnapshotRows } from "./parlay-snapshot-db";
import { parseFanDuelSnapshot, snapshotSlotForInstant, selectionMatches, isPotentialSnapshotInstant, type SnapshotOddsEvent, type SnapshotSlot } from "./parlay-snapshot-core";
import { fetchSnapshotFanDuelMarkets, fetchSportsOddsUsage } from "./sports-odds";

export async function runSundaySnapshots(args: { nowIso?: string; dryRun?: boolean } = {}) {
  const nowIso = args.nowIso ?? new Date().toISOString();
  if (process.env.PARLAY_SNAPSHOTS_ENABLED !== "true") {
    return { status: "disabled" as const, reason: "Set PARLAY_SNAPSHOTS_ENABLED=true in Vercel Production." };
  }
  // Cheap guard: no ESPN or SportsGameOdds requests on the other 6.99 days.
  if (!args.dryRun && !isPotentialSnapshotInstant(nowIso)) {
    return { status: "no_window" as const, reason: "Not in the Sunday snapshot window." };
  }
  const context = await getCurrentParlayContext();
  const slot = snapshotSlotForInstant(nowIso, context.sundayDate);
  if (!args.dryRun && !slot) {
    return { status: "no_window" as const, reason: "NFL Sunday does not match the local snapshot date." };
  }
  const picks = (await listSnapshotPicks(context.season, context.week))
    .filter(pick => pick.bookmaker?.toLowerCase() === "fanduel");
  const allPicks = picks.filter(pick => Date.parse(pick.event_starts_at) > Date.parse(nowIso));
  const before = await listSnapshots(context.season, context.week);
  const pending = allPicks.filter(pick => !slot || !before.some(record => record.submission_id === pick.id &&
    record.snapshot_slot === slot && selectionMatches(record, pick)));
  if (args.dryRun) {
    // Dry run deliberately does not contact the paid-data API or write Supabase.
    return { status: "preview" as const, season: context.season, week: context.week,
      sundayDate: context.sundayDate, activeWebsitePicks: picks.length,
      pregamePicks: allPicks.length, awaitingSnapshot: pending.length,
      note: "No FanDuel API requests, database writes, or bet grades performed." };
  }
  const activeSlot = slot as SnapshotSlot;
  const startedAt = new Date().toISOString();
  let captured = 0;
  const attempted = pending.length;
  const failures: { team: string; reason: string }[] = [];
  let errorMessage: string | null = null;
  let usageWarning: string | null = null;
  try {
    if (pending.length) {
      const usage = await fetchSportsOddsUsage();
      if (usage?.warning) usageWarning = `SportsGameOdds key at ${usage.percent.toFixed(1)}% of monthly objects.`;
      const games = await fetchSnapshotFanDuelMarkets(pending.map(pick => ({ eventId: pick.event_id, oddId: pick.market_id })));
      const gamesById = new Map<string, SnapshotOddsEvent>(games.map(event => [String(event.eventID), event]));
      const capturedAt = new Date().toISOString();
      // Provider latency must not turn a post-kickoff observation into an
      // apparently valid 11:56 AM pregame quote.
      if (snapshotSlotForInstant(capturedAt, context.sundayDate) !== activeSlot) {
        failures.push(...pending.map(pick => ({ team: pick.team_name, reason: "Request completed after capture window" })));
      } else {
        const findings = pending.map(pick => ({ pick, ...parseFanDuelSnapshot({
          pick, event: gamesById.get(pick.event_id), slot: activeSlot, capturedAt
        }) }));
        const rows = findings.flatMap(item => item.record ? [item.record] : []);
        await storeSnapshotRows(rows);
        captured = rows.length;
        failures.push(...findings.filter(item => item.reason).map(item => ({
          team: item.pick.team_name, reason: item.reason ?? "Unknown issue"
        })));
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Snapshot provider error";
  }
  const status = errorMessage ? "error" : failures.length ? "partial" : "success";
  await saveSnapshotRun({
    started_at: startedAt, finished_at: new Date().toISOString(),
    season: context.season, week: context.week, slot: activeSlot, status,
    attempted, captured, failures, error_message: errorMessage, usage_warning: usageWarning
  });
  if (errorMessage) throw new Error(errorMessage);
  return { status, season: context.season, week: context.week, slot: activeSlot,
    attempted, captured, failures, usageWarning };
}
