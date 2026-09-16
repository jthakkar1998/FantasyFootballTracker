import assert from "node:assert/strict";
import test from "node:test";
import { generateWeekObligations } from "../lib/penalties";
import type { EspnLeagueResponse } from "../lib/types";

const league: EspnLeagueResponse = {
  id: 666066604,
  seasonId: 2026,
  settings: {
    name: "Test League",
    rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "20": 5, "21": 1 } }
  },
  teams: [
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" }
  ]
};

const boxscore: EspnLeagueResponse = {
  id: 666066604,
  seasonId: 2026,
  schedule: [
    {
      id: 1,
      matchupPeriodId: 1,
      winner: "AWAY",
      home: {
        teamId: 1,
        totalPoints: 80,
        rosterForCurrentScoringPeriod: {
          entries: [
            { playerId: 101, lineupSlotId: 0, playerPoolEntry: { appliedStatTotal: 0, player: { fullName: "Zero QB" } } },
            { playerId: 102, lineupSlotId: 2, playerPoolEntry: { appliedStatTotal: -1, player: { fullName: "Negative RB" } } }
          ]
        }
      },
      away: {
        teamId: 2,
        totalPoints: 100,
        rosterForCurrentScoringPeriod: {
          entries: [
            { playerId: 201, lineupSlotId: 0, playerPoolEntry: { appliedStatTotal: 20, player: { fullName: "Good QB" } } },
            { playerId: 202, lineupSlotId: 2, playerPoolEntry: { appliedStatTotal: 10, player: { fullName: "Good RB 1" } } },
            { playerId: 203, lineupSlotId: 2, playerPoolEntry: { appliedStatTotal: 12, player: { fullName: "Good RB 2" } } }
          ]
        }
      }
    }
  ]
};

test("generates recap, zero, negative, and empty-slot obligations", () => {
  const rows = generateWeekObligations({
    season: 2026,
    week: 1,
    league,
    boxscore,
    deadline: { firstKickoff: "2026-09-17T00:15:00Z", sundayDate: "2026-09-20" }
  });

  assert.equal(rows.filter((row) => row.type === "WEEKLY_RECAP").length, 1);
  assert.equal(rows.find((row) => row.type === "WEEKLY_RECAP")?.team_name, "Alpha");
  assert.equal(rows.filter((row) => row.type === "ZERO_SCORE").length, 1);
  assert.equal(rows.find((row) => row.type === "ZERO_SCORE")?.penalty_units, 1);
  assert.equal(rows.filter((row) => row.type === "NEGATIVE_SCORE").length, 1);
  assert.equal(rows.find((row) => row.type === "NEGATIVE_SCORE")?.penalty_units, 2);
  assert.equal(rows.filter((row) => row.type === "EMPTY_SLOT").length, 1);
  assert.equal(rows.find((row) => row.type === "EMPTY_SLOT")?.penalty_units, 3);
});
