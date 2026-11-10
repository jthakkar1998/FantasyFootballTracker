import assert from "node:assert/strict";
import test from "node:test";
import { verifiedNflSundayDate } from "../lib/nfl-week-calendar";
import { findUniqueSundayOddsGame, oddsPlayerTeamVerified } from "../lib/nfl-team-game";
import { matchesEspnProTeam, NFL_PRO_TEAMS } from "../lib/nfl-team-names";
import { loadCachedNflSchedule, nflScheduleCachePolicy, validNflEvents } from "../lib/nfl-schedule-policy";
import type { NflEvent } from "../lib/types";

function event(id = "401", kickoff = "2026-11-15T18:00:00Z"): NflEvent {
  return { id, date: kickoff, competitions: [{ competitors: [
    { homeAway: "home", team: { id: "1", displayName: "Atlanta Falcons" } },
    { homeAway: "away", team: { id: "12", displayName: "Kansas City Chiefs" } }
  ] }] };
}

const oddsGame = {
  eventID: "sgo-123", startsAt: "2026-11-15T18:00:00Z",
  teams: {
    home: { teamID: "ATL_NFL", names: { long: "Atlanta Falcons", short: "ATL" } },
    away: { teamID: "KC_NFL", names: { long: "Kansas City Chiefs", short: "KC" } }
  }
};

test("verified 2026 Sunday dates require no network and reject unverified years/weeks", () => {
  assert.equal(verifiedNflSundayDate(2026, 1), "2026-09-13");
  assert.equal(verifiedNflSundayDate(2026, 9), "2026-11-08");
  assert.equal(verifiedNflSundayDate(2026, 10), "2026-11-15");
  assert.equal(verifiedNflSundayDate(2026, 18), "2027-01-10");
  assert.equal(verifiedNflSundayDate(2027, 1), null);
  assert.equal(verifiedNflSundayDate(2026, 19), null);
});

test("full 32-club ESPN IDs and team names provide strict matching", () => {
  assert.equal(Object.keys(NFL_PRO_TEAMS).length, 32);
  assert.equal(matchesEspnProTeam(1, { names: { long: "Atlanta Falcons" } }), true);
  assert.equal(matchesEspnProTeam(12, { names: { short: "KC" } }), true);
  assert.equal(matchesEspnProTeam(24, { names: { long: "LA Chargers" } }), true);
  assert.equal(matchesEspnProTeam(14, { names: { long: "LA Rams" } }), true);
  assert.equal(matchesEspnProTeam(12, { names: { long: "Atlanta Falcons" } }), false);
  assert.equal(matchesEspnProTeam(0, { names: { long: "Atlanta Falcons" } }), false);
});

test("SportsGameOdds Sunday slate resolves exactly one correct team/game", () => {
  assert.deepEqual(findUniqueSundayOddsGame([oddsGame], 12, "2026-11-15"), oddsGame);
  assert.equal(findUniqueSundayOddsGame([oddsGame], 19, "2026-11-15"), null);
  assert.equal(findUniqueSundayOddsGame([oddsGame], 12, "2026-11-08"), null);
  assert.equal(findUniqueSundayOddsGame([oddsGame, { ...oddsGame, eventID: "duplicate" }], 12, "2026-11-15"), null);
  assert.equal(findUniqueSundayOddsGame([{ ...oddsGame, startsAt: "2026-11-16T02:00:00Z" }], 12, "2026-11-15")?.eventID, "sgo-123");
  assert.equal(findUniqueSundayOddsGame([{ ...oddsGame, startsAt: "2026-11-16T18:00:00Z" }], 12, "2026-11-15"), null);
  assert.equal(findUniqueSundayOddsGame([{ ...oddsGame, status: { started: true } }], 12, "2026-11-15"), null);
  assert.equal(oddsPlayerTeamVerified(oddsGame, 12, "KC_NFL"), true);
  assert.equal(oddsPlayerTeamVerified(oddsGame, 12, "ATL_NFL"), false);
});

test("schedule must have real event IDs, kickoff and exactly two different teams", () => {
  assert.equal(validNflEvents([event()]), true);
  assert.equal(validNflEvents([]), false);
  assert.equal(validNflEvents([event(), event()]), false);
  assert.equal(validNflEvents([{ ...event(), date: "invalid" }]), false);
  assert.equal(validNflEvents([{ ...event(), competitions: [] }]), false);
});

test("cache avoids provider calls on a fresh previously verified schedule", async () => {
  let calls = 0;
  const results = await loadCachedNflSchedule({
    cached: { payload: [event()], fetchedAt: "2026-11-15T14:00:00Z" },
    nowMs: Date.parse("2026-11-15T14:10:00Z"),
    policy: { freshMs: 3600_000, staleOnErrorMs: 2 * 86400_000 },
    fetchFresh: async () => { calls++; throw new Error("should never reach ESPN"); },
    saveFresh: async () => { throw new Error("should never write"); }
  });
  assert.equal(results[0].id, "401");
  assert.equal(calls, 0);
});

test("after provider 403, use validated recent cache but never invent new games", async () => {
  let warnings = 0;
  const shared = {
    nowMs: Date.parse("2026-11-15T15:00:00Z"),
    policy: { freshMs: 3600_000, staleOnErrorMs: 2 * 86400_000 },
    fetchFresh: async () => { throw new Error("NFL schedule request failed (403)"); },
    saveFresh: async () => {},
    onWarning: (_: string) => { warnings++; }
  };
  const cached = { payload: [event()], fetchedAt: "2026-11-15T12:00:00Z" };
  assert.equal((await loadCachedNflSchedule({ ...shared, cached }))[0].id, "401");
  assert.equal(warnings, 1);
  await assert.rejects(loadCachedNflSchedule({ ...shared, cached: null }), /403/);
  await assert.rejects(loadCachedNflSchedule({ ...shared, cached: { payload: [], fetchedAt: cached.fetchedAt } }), /403/);
  await assert.rejects(loadCachedNflSchedule({ ...shared, cached: { payload: [event()], fetchedAt: "2026-11-01T12:00:00Z" } }), /403/);
});

test("stale refresh writes valid schedule; failed cache write does not block data", async () => {
  let attempts = 0;
  const results = await loadCachedNflSchedule({
    cached: null, nowMs: Date.parse("2026-11-15T15:00:00Z"),
    policy: nflScheduleCachePolicy("2026-11-15", Date.parse("2026-11-15T15:00:00Z")),
    fetchFresh: async () => [event()],
    saveFresh: async () => { attempts++; throw new Error("cache unavailable"); }
  });
  assert.equal(results.length, 1);
  assert.equal(attempts, 1);
  const active = nflScheduleCachePolicy("2026-11-15", Date.parse("2026-11-15T15:00:00Z"));
  const historical = nflScheduleCachePolicy("2026-11-08", Date.parse("2026-11-15T15:00:00Z"));
  assert.ok(active.freshMs < historical.freshMs);
});
