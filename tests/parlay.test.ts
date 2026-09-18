import assert from "node:assert/strict";
import test from "node:test";
import { parlayDeadlineIso } from "../lib/parlay-time";
import { normalizePlayerName } from "../lib/sports-odds";

test("parlay deadline uses Central daylight time in September", () => {
  assert.equal(parlayDeadlineIso("2026-09-20"), "2026-09-20T15:30:00.000Z");
});

test("parlay deadline uses Central standard time after DST ends", () => {
  assert.equal(parlayDeadlineIso("2026-11-08"), "2026-11-08T16:30:00.000Z");
});

test("player-name normalization tolerates suffixes and punctuation", () => {
  assert.equal(normalizePlayerName("Marvin Harrison Jr."), "marvin harrison");
  assert.equal(normalizePlayerName("D'Andre Swift"), "dandre swift");
});
