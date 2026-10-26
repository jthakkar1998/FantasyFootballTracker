import assert from "node:assert/strict";
import test from "node:test";
import { diffBet, exportBetsCsv, importBetsCsv, initialBet, readCsv, rowKey } from "../lib/parlay-bulk";
import type { ParlayCommissionerRow } from "../lib/parlay-admin";

const row = (week: number, teamId: number, overrides: Partial<ParlayCommissionerRow> = {}): ParlayCommissionerRow => ({
  season: 2026, week, teamId, teamName: `Team ${teamId}`,
  pick: null, tracking: null, hasWebsitePick: false, hasOutsidePick: false,
  paymentVerifiedAt: null, ...overrides
});
const base = [row(1, 10), row(1, 20), row(7, 10)];
const initial = Object.fromEntries(base.map(r => [rowKey(r.season, r.week, r.teamId), initialBet(r)]));

test("a bulk edit of off-app details, outcome, and payment saves as one row patch", () => {
  const changed = { ...initial[rowKey(2026, 1, 10)], source: "outside" as const, details: "Josh Allen over 225.5", result: "hit" as const, paid: true };
  assert.deepEqual(diffBet(base[0], initial[rowKey(2026, 1, 10)], changed), {
    season: 2026, week: 1, teamId: 10,
    outside: true, details: "Josh Allen over 225.5", result: "hit", paymentReceived: true
  });
});

test("no update is sent for untouched fields, preventing unnecessary resets", () => {
  assert.equal(diffBet(base[0], initial[rowKey(2026, 1, 10)], initial[rowKey(2026, 1, 10)]), null);
  const changed = { ...initial[rowKey(2026, 1, 10)], paid: true };
  assert.deepEqual(diffBet(base[0], initial[rowKey(2026, 1, 10)], changed), {
    season: 2026, week: 1, teamId: 10, paymentReceived: true
  });
});

test("CSV exports all league teams across multiple weeks with stable team IDs", () => {
  const csv = exportBetsCsv(base, initial);
  const records = readCsv(csv);
  assert.equal(records.length, 4);
  assert.deepEqual(records[0], ["season", "week", "team_id", "team_name", "source", "bet_details", "result", "payment_received"]);
  assert.deepEqual(records.slice(1).map(r => `${r[1]}-${r[2]}`), ["1-10", "1-20", "7-10"]);
});

test("CSV handles quoted descriptions with commas, quotes, and line breaks", () => {
  const current = { ...initial, [rowKey(2026, 1, 10)]: { ...initial[rowKey(2026, 1, 10)], source: "outside" as const, details: 'Josh "J" Allen, over\n200.5 yards' } };
  const csv = exportBetsCsv(base, current);
  const imported = importBetsCsv(csv, base, initial);
  assert.equal(imported[rowKey(2026, 1, 10)].details, 'Josh "J" Allen, over\n200.5 yards');
});

test("CSV import stages multiple weeks without making database calls", () => {
  const csv = exportBetsCsv(base, initial)
    .replace("2026,1,10,Team 10,none,,pending,no", "2026,1,10,Team 10,outside,Player over 60 yards,hit,yes")
    .replace("2026,7,10,Team 10,none,,pending,no", "2026,7,10,Team 10,outside,Player under 60 yards,miss,no");
  const imported = importBetsCsv(csv, base, initial);
  assert.equal(imported[rowKey(2026, 1, 10)].result, "hit");
  assert.equal(imported[rowKey(2026, 1, 10)].paid, true);
  assert.equal(imported[rowKey(2026, 7, 10)].result, "miss");
  assert.equal(imported[rowKey(2026, 1, 20)].source, "none");
  assert.equal(initial[rowKey(2026, 1, 10)].source, "none");
});

test("CSV rejects unknown IDs and duplicate rows rather than assigning to wrong teams", () => {
  const csv = exportBetsCsv(base, initial);
  assert.throws(() => importBetsCsv(csv.replace("2026,1,10", "2026,1,999"), base, initial), /Unknown season\/week\/team_id/);
  assert.throws(() => importBetsCsv(csv + "2026,1,10,Team 10,none,,pending,no\n", base, initial), /Duplicate team and week/);
});

test("CSV protects website submissions from being overwritten as outside picks", () => {
  const website = row(2, 33, { hasWebsitePick: true, pick: { id: "00000000-0000-0000-0000-000000000033", result_status: "pending" } as ParlayCommissionerRow["pick"] });
  const starting = { [rowKey(2026, 2, 33)]: initialBet(website) };
  assert.throws(() => importBetsCsv("season,week,team_id,team_name,source,bet_details,result,payment_received\n2026,2,33,Team 33,outside,test,hit,yes", [website], starting), /must retain source=website/);
  const after = { ...starting[rowKey(2026, 2, 33)], result: "miss" as const };
  assert.deepEqual(diffBet(website, starting[rowKey(2026, 2, 33)], after), {
    season: 2026, week: 2, teamId: 33, websitePickId: "00000000-0000-0000-0000-000000000033", result: "miss"
  });
});

test("CSV rejects ambiguous source=none with betting details or a result", () => {
  assert.throws(() => importBetsCsv("season,week,team_id,team_name,source,bet_details,result,payment_received\n2026,1,10,Team 10,none,Joe Burrow O250,hit,yes", base, initial), /source=outside/);
});

test("removing an off-app pick clears its saved details and outcome without touching payment", () => {
  const previous = row(1, 10, {
    hasOutsidePick: true,
    tracking: {
      season: 2026, week: 1, team_id: 10, submitted_outside_app: true,
      outside_bet_details: "Old bet", outside_result_status: "hit", outside_graded_at: "2026-09-01T00:00:00Z",
      payment_verified_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z"
    },
    paymentVerifiedAt: "2026-09-01T00:00:00Z"
  });
  const before = initialBet(previous);
  assert.deepEqual(diffBet(previous, before, { ...before, source: "none", details: "", result: "pending" }), {
    season: 2026, week: 1, teamId: 10, outside: false, details: "", result: "pending"
  });
});
