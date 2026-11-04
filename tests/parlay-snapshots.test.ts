import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chooseGradingSnapshot, isPotentialSnapshotInstant, parseFanDuelSnapshot, selectionMatches, snapshotSlotForInstant,
  type SnapshotOddsEvent, type SnapshotPick, type SnapshotRecord
} from "../lib/parlay-snapshot-core";
import { zonedLocalToIso } from "../lib/parlay-time";

const pick: SnapshotPick = {
  id: "a", season: 2026, week: 8, team_id: 1, team_name: "HAMAS", player_name: "Receiver X",
  sportsbook_player_id: "player1", event_id: "event1", event_starts_at: "2026-11-08T18:00:00.000Z",
  market_id: "receiving_yards-player1-game-ou-over", market_name: "Receiving Yards", stat_id: "receiving_yards",
  side_id: "over", line: "90.5", odds: "-110", bookmaker: "fanduel"
};
const example: SnapshotOddsEvent = {
  eventID: "event1", status: { started: false, startsAt: "2026-11-08T18:00:00.000Z" },
  odds: { [pick.market_id]: {
    oddID: pick.market_id, playerID: "player1", statID: "receiving_yards", sideID: "over", betTypeID: "ou",
    byBookmaker: { fanduel: { odds: "-110", overUnder: "92.5", available: true, lastUpdatedAt: "2026-11-08T17:51:00.000Z" } }
  } }
};
const at = (sunday: string, hour: number, minute: number) => zonedLocalToIso(sunday, hour, minute, "America/Chicago");
const capture = (event: SnapshotOddsEvent = example, capturedAt = at("2026-11-08", 11, 56)) =>
  parseFanDuelSnapshot({ pick, event, slot: "primary", capturedAt });

test("backup and primary windows respect CDT/CST and exclude the lock and kickoff", () => {
  for (const sunday of ["2026-09-20", "2026-11-01", "2026-11-08"]) {
    for (const [hour, minute, expected] of [[11, 45, "backup"], [11, 54, "backup"], [11, 55, null], [11, 56, "primary"], [11, 59, "primary"], [12, 0, null]] as const) {
      assert.equal(snapshotSlotForInstant(at(sunday, hour, minute), sunday), expected);
      assert.equal(isPotentialSnapshotInstant(at(sunday, hour, minute)), expected !== null);
    }
  }
});

test("valid snapshot uses sportsbook-specific Sunday O/U, not Thursday or consensus line", () => {
  const result = capture();
  assert.equal(result.reason, null);
  assert.equal(result.record?.line, "92.5");
  assert.equal(result.record?.odds, "-110");
  assert.equal(result.record?.quote_updated_at, "2026-11-08T17:51:00.000Z");
  assert.equal(pick.line, "90.5");
});

test("unavailable/suspended/invalid markets are never stored", () => {
  assert.match(capture({ ...example, odds: {} }).reason ?? "", /Exact selected market/);
  assert.match(capture({ ...example, odds: { [pick.market_id]: {
    ...example.odds![pick.market_id], byBookmaker: { fanduel: { odds: "-110", overUnder: "92.5", available: false } }
  } } }).reason ?? "", /unavailable/);
  assert.match(capture({ ...example, odds: { [pick.market_id]: {
    ...example.odds![pick.market_id], playerID: "wrong"
  } } }).reason ?? "", /mismatch/);
  assert.match(capture({ ...example, odds: { [pick.market_id]: {
    ...example.odds![pick.market_id], byBookmaker: { fanduel: { odds: "-110", available: true, lastUpdatedAt: "2026-11-08T17:51:00.000Z" } }
  } } }).reason ?? "", /line missing/);
});

test("stale, post-kickoff, and future-dated quotes are refused", () => {
  assert.match(capture(example, "2026-11-08T18:00:00.000Z").reason ?? "", /Game started/);
  const oldQuote: SnapshotOddsEvent = structuredClone(example);
  oldQuote.odds![pick.market_id].byBookmaker!.fanduel!.lastUpdatedAt = "2026-11-08T17:20:00.000Z";
  assert.match(capture(oldQuote).reason ?? "", /too old/);
  const future: SnapshotOddsEvent = structuredClone(example);
  future.odds![pick.market_id].byBookmaker!.fanduel!.lastUpdatedAt = "2026-11-08T18:00:00.000Z";
  assert.match(capture(future).reason ?? "", /future-dated/);
});

test("valid yes/no touchdown market stores a null line", () => {
  const yesPick = { ...pick, stat_id: "touchdowns", side_id: "yes", market_id: "touchdowns-player1-game-yn-yes", line: null };
  const result = parseFanDuelSnapshot({ pick: yesPick, slot: "primary", capturedAt: at("2026-11-08", 11, 56), event: {
    eventID: "event1", odds: { [yesPick.market_id]: {
      oddID: yesPick.market_id, playerID: "player1", statID: "touchdowns", sideID: "yes", betTypeID: "yn",
      byBookmaker: { fanduel: { odds: "+175", available: true, lastUpdatedAt: "2026-11-08T17:51:00Z" } }
    } }
  } });
  assert.equal(result.reason, null);
  assert.equal(result.record?.line, null);
});

test("replaced picks cannot borrow a previous player's backup", () => {
  const backup = { ...capture().record!, snapshot_slot: "backup" as const };
  assert.equal(selectionMatches(backup, pick), true);
  const switched = { ...pick, market_id: "different-market" };
  assert.equal(chooseGradingSnapshot(switched, [backup]).source, "missing");
  assert.equal(chooseGradingSnapshot(pick, [backup]).source, "backup");
  const primary = { ...backup, snapshot_slot: "primary" as const, line: "94.5" };
  assert.equal(chooseGradingSnapshot(pick, [backup, primary]).selected?.line, "94.5");
});

test("only new snapshot tables are created; stored bets remain unchanged", () => {
  const sql = readFileSync("supabase/parlay-line-snapshots-migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.parlay_line_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.parlay_snapshot_runs/);
  assert.doesNotMatch(sql, /(?:DELETE FROM|TRUNCATE|UPDATE) public\.parlay_submissions/i);
  const enable = readFileSync("supabase/parlay-line-snapshots-enable.sql", "utf8");
  const disable = readFileSync("supabase/parlay-line-snapshots-disable.sql", "utf8");
  assert.match(enable, /45,50,54 16,17/);
  assert.match(enable, /56,57,58 16,17/);
  assert.doesNotMatch(disable, /ffball-parlay-(?:thu|fri|sat|sunday)/i);
});

test("Supabase Cron SQL covers backup/primary capture times across daylight saving", () => {
  const enable = readFileSync("supabase/parlay-line-snapshots-enable.sql", "utf8");
  for (const sunday of ["2026-10-25", "2026-11-01", "2026-11-08"]) {
    for (const [minute, slot] of [[45, "backup"], [50, "backup"], [54, "backup"], [56, "primary"], [57, "primary"], [58, "primary"]] as const) {
      const instant = at(sunday, 11, minute);
      const utcHour = new Date(instant).getUTCHours();
      assert.ok(utcHour === 16 || utcHour === 17, `${sunday} ${instant}`);
      assert.equal(snapshotSlotForInstant(instant, sunday), slot);
    }
  }
  assert.match(enable, /ffball-parlay-snapshot-backup/);
  assert.match(enable, /ffball-parlay-snapshot-primary/);
});

test("snapshot endpoint uses scoped existing Supabase token and never invokes grading", () => {
  const route = readFileSync("app/api/cron/parlay-snapshot/route.ts", "utf8");
  const worker = readFileSync("lib/parlay-snapshots.ts", "utf8");
  assert.match(route, /PARLAY_REMINDER_CRON_SECRET/);
  assert.doesNotMatch(route, /process\.env\.CRON_SECRET/);
  assert.match(worker, /status: "preview"/);
  assert.doesNotMatch(worker, /updateParlayAdminStatus|result_status|payment_verified_at/);
  const migrate = readFileSync("supabase/parlay-line-snapshots-migration.sql", "utf8");
  assert.match(migrate, /ffball_reminder_url/);
  assert.match(migrate, /ffball_reminder_token/);
  assert.match(migrate, /\?dryRun=1/);
});
