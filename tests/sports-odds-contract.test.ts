// Build-time regression guard: both snapshot functions must remain exported
// when updating SportsGameOdds logic for schedule reliability.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const moduleSource = readFileSync(join(process.cwd(), "lib", "sports-odds.ts"), "utf8");

test("SportsGameOdds module preserves website and snapshot exports", () => {
  const expectedExports = [
    "sportsOddsConfigured", "normalizePlayerName", "getFanDuelProps",
    "fetchSnapshotFanDuelMarkets", "fetchSportsOddsUsage"
  ];
  for (const fn of expectedExports) {
    assert.match(moduleSource, new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(`), `${fn} export required`);
  }
});
