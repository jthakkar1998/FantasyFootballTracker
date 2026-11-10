import assert from "node:assert/strict";
import test from "node:test";
import { extractEspnNflMetric, gradeStat, isNflBoxscoreFinal, makeBaseGradeDecision, isPotentialGradeInstant, type EspnNflSummary, type GradingPick } from "../lib/parlay-grade-core";
import type { SnapshotRecord } from "../lib/parlay-snapshot-core";

const final: EspnNflSummary = {
  header: { competitions: [{ status: { type: { completed: true, name: "STATUS_FINAL" } } }] },
  boxscore: { players: [{ statistics: [
    { name: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LNG", "TGTS"], athletes: [
      { athlete: { id: "123", displayName: "Sample Player" }, stats: ["6", "87", "14.5", "1", "29", "8"] }
    ] },
    { name: "rushing", labels: ["CAR", "YDS", "AVG", "TD", "LNG"], athletes: [
      { athlete: { id: "123", displayName: "Sample Player" }, stats: ["4", "23", "5.8", "0", "12"] }
    ] },
    { name: "passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT"], athletes: [
      { athlete: { id: "777" }, stats: ["20/33", "240", "7.3", "2", "1"] }
    ] },
    { name: "kicking", labels: ["FG", "PCT", "LONG", "XP", "PTS"], athletes: [
      { athlete: { id: "999" }, stats: ["2/3", "66.7", "44", "3/3", "9"] }
    ] }
  ] }] }
};

function pick(): GradingPick {
  return { id: "00000000-0000-0000-0000-000000000123", season: 2026, week: 9,
    team_id: 1, team_name: "Sample team", player_name: "Sample Player", espn_player_id: 123,
    sportsbook_player_id: "sports-123", event_id: "event-1", event_starts_at: "2026-11-08T18:00:00Z",
    market_id: "market-1", market_name: "Receptions", stat_id: "receiving_receptions",
    side_id: "over", line: "5.5", odds: "-110", bookmaker: "fanduel",
    result_status: "pending", grade_source: null, eligibility_at_lock: true, withdrawn_at: null };
}
function snapshot(slot: "backup" | "primary"): SnapshotRecord {
  const p = pick();
  return { submission_id: p.id, season: p.season, week: p.week, team_id: p.team_id,
    snapshot_slot: slot, event_id: p.event_id, market_id: p.market_id,
    sportsbook_player_id: p.sportsbook_player_id, stat_id: p.stat_id, side_id: p.side_id,
    line: "6.5", odds: "-115", captured_at: "2026-11-08T17:56:00Z",
    quote_updated_at: "2026-11-08T17:54:00Z" };
}

test("reads only exact NFL athlete and category, and checks final status", () => {
  assert.equal(isNflBoxscoreFinal(final), true);
  assert.equal(isNflBoxscoreFinal({ boxscore: final.boxscore }), false);
  assert.equal(extractEspnNflMetric(final, 123, "receiving_receptions").value, 6);
  assert.equal(extractEspnNflMetric(final, 123, "receiving_yards").value, 87);
  assert.equal(extractEspnNflMetric(final, 123, "rushing+receiving_yards").value, 110);
  assert.equal(extractEspnNflMetric(final, 777, "passing_completions").value, 20);
  assert.equal(extractEspnNflMetric(final, 777, "passing_attempts").value, 33);
  assert.equal(extractEspnNflMetric(final, 999, "fieldGoals_made").value, 2);
  assert.equal(extractEspnNflMetric(final, 999, "kicking_totalPoints").value, 9);
  assert.equal(extractEspnNflMetric(final, 999, "receiving_receptions").value, null);
  assert.equal(extractEspnNflMetric(final, 123, "unsupported_stat").value, null);
});

test("grades strict over/under, incl pushes, from snapshotted line only", () => {
  assert.equal(gradeStat({statId:"receiving_receptions",side:"over",line:"5.5",value:6}).result, "hit");
  assert.equal(gradeStat({statId:"receiving_receptions",side:"over",line:"6.5",value:6}).result, "miss");
  assert.equal(gradeStat({statId:"rushing_yards",side:"under",line:"90.5",value:87}).result, "hit");
  assert.equal(gradeStat({statId:"rushing_yards",side:"over",line:"87",value:87}).result, "push");
  assert.equal(gradeStat({statId:"rushing_yards",side:"over",line:null,value:87}).result, null);
});

test("anytime touchdown with 0 rush/receiving TDs is review, never guessed miss", () => {
  assert.equal(gradeStat({statId:"touchdowns",side:"yes",line:null,value:1}).result, "hit");
  assert.equal(gradeStat({statId:"touchdowns",side:"yes",line:null,value:0}).result, null);
  assert.equal(gradeStat({statId:"rushing_touchdowns",side:"yes",line:null,value:0}).result, "miss");
});

test("requires matching primary snapshot and confirmed fantasy lineup lock", () => {
  const p = pick();
  assert.equal(makeBaseGradeDecision(p, [snapshot("primary")]).status, "ready");
  assert.equal(makeBaseGradeDecision(p, [snapshot("backup")]).status, "review");
  assert.equal(makeBaseGradeDecision({ ...p, eligibility_at_lock: null }, [snapshot("primary")]).status, "review");
  assert.equal(makeBaseGradeDecision({ ...p, grade_source: "manual" }, [snapshot("primary")]).status, "already_graded");
  assert.equal(makeBaseGradeDecision({ ...p, result_status: "hit" }, [snapshot("primary")]).status, "already_graded");
  assert.equal(makeBaseGradeDecision({ ...p, market_id: "changed" }, [snapshot("primary")]).status, "review");
});

test("Monday/Tuesday Central time guard handles daylight saving", () => {
  assert.equal(isPotentialGradeInstant("2026-11-09T15:15:00Z"), true); // 9:15 CST
  assert.equal(isPotentialGradeInstant("2026-11-10T15:45:00Z"), true); // 9:45 CST
  assert.equal(isPotentialGradeInstant("2026-11-09T14:15:00Z"), false); // 8:15 CST
  assert.equal(isPotentialGradeInstant("2026-11-08T17:56:00Z"), false); // Sunday
  assert.equal(isPotentialGradeInstant("2026-09-14T14:15:00Z"), true); // 9:15 CDT
});
