import assert from "node:assert/strict";
import test from "node:test";
import { makeParlayCommissionerRows } from "../lib/parlay-admin";
import type { ParlaySubmission } from "../lib/parlay-types";
import type { ParlayWeeklyTeamTracking } from "../lib/parlay-admin";

const pick = (week: number, team_id: number, overrides: Partial<ParlaySubmission> = {}) => ({
  season: 2026, week, team_id, team_name: `Team ${team_id}`, withdrawn_at: null,
  payment_verified_at: null, ...overrides
}) as ParlaySubmission;
const record = (week: number, team_id: number, overrides: Partial<ParlayWeeklyTeamTracking> = {}) => ({
  season: 2026, week, team_id, submitted_outside_app: false,
  payment_verified_at: null, outside_bet_details: null, outside_result_status: "pending",
  outside_graded_at: null, updated_at: new Date(0).toISOString(), ...overrides
}) as ParlayWeeklyTeamTracking;
const teams = [
  { teamId: 2, teamName: "Zebra" },
  { teamId: 1, teamName: "Alpha" },
  { teamId: 3, teamName: "Sundays" }
];

test("renders every team in every week through current week, including Week 1", () => {
  const rows = makeParlayCommissionerRows({ season: 2026, throughWeek: 8, teams, submissions: [], tracking: [] });
  assert.equal(rows.length, 24);
  assert.deepEqual(rows.slice(0, 3).map(row => row.teamName), ["Alpha", "Sundays", "Zebra"]);
  assert.deepEqual(rows.slice(-3).map(row => row.week), [1, 1, 1]);
  assert.ok(rows.every(row => !row.hasWebsitePick && !row.hasOutsidePick));
});

test("shows real website picks and separately tracks paid off-app bets", () => {
  const rows = makeParlayCommissionerRows({
    season: 2026, throughWeek: 2, teams,
    submissions: [pick(2, 1)],
    tracking: [record(2, 2, { submitted_outside_app: true, payment_verified_at: "2026-10-20T18:00:00Z" })]
  });
  assert.equal(rows.find(r => r.week === 2 && r.teamId === 1)?.hasWebsitePick, true);
  const outside = rows.find(r => r.week === 2 && r.teamId === 2);
  assert.equal(outside?.hasOutsidePick, true);
  assert.equal(outside?.paymentVerifiedAt, "2026-10-20T18:00:00Z");
  assert.equal(rows.find(r => r.week === 2 && r.teamId === 3)?.hasOutsidePick, false);
});

test("a live website pick takes precedence over a stale off-app flag", () => {
  const [row] = makeParlayCommissionerRows({
    season: 2026, throughWeek: 1, teams: [teams[0]], submissions: [pick(1, 2)],
    tracking: [record(1, 2, { submitted_outside_app: true })]
  });
  assert.equal(row.hasWebsitePick, true);
  assert.equal(row.hasOutsidePick, false);
});

test("withdrawn website pick is not considered a submitted pick", () => {
  const [row] = makeParlayCommissionerRows({
    season: 2026, throughWeek: 1, teams: [teams[0]],
    submissions: [pick(1, 2, { withdrawn_at: "2026-09-14T12:00:00Z" })], tracking: []
  });
  assert.equal(row.hasWebsitePick, false);
});

test("an explicit unverified tracking record overrides legacy website payment timestamp", () => {
  const [row] = makeParlayCommissionerRows({
    season: 2026, throughWeek: 1, teams: [teams[0]],
    submissions: [pick(1, 2, { payment_verified_at: "2026-09-14T12:00:00Z" })],
    tracking: [record(1, 2, { payment_verified_at: null })]
  });
  assert.equal(row.paymentVerifiedAt, null);
});

test("does not mix years and retains a team found only in old submissions", () => {
  const rows = makeParlayCommissionerRows({
    season: 2026, throughWeek: 1, teams: [],
    submissions: [pick(1, 17, { team_name: "Late Added" }), pick(1, 99, { season: 2025 })],
    tracking: [record(1, 18, { submitted_outside_app: true })]
  });
  assert.deepEqual(rows.map(r => r.teamId), [17, 18]);
});
