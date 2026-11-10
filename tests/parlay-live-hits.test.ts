import assert from "node:assert/strict";
import test from "node:test";
import {
  chicagoLiveHitWindow, eligibleLiveHitPick, evaluateLiveHit, liveHitNotificationCopy,
  type LiveHitPick
} from "../lib/parlay-live-hit-core";
import type { SnapshotRecord } from "../lib/parlay-snapshot-core";
import type { EspnNflSummary } from "../lib/parlay-grade-core";

function pick(overrides: Partial<LiveHitPick> = {}): LiveHitPick {
  return {
    id: "00000000-0000-0000-0000-000000000888", season: 2026, week: 10,
    team_id: 1, team_name: "Test Team", player_name: "Test Receiver", espn_player_id: 123,
    pro_team_id: 19, sportsbook_player_id: "fanduel-player", event_id: "provider-game",
    event_starts_at: "2026-11-15T18:00:00Z", market_id: "market-1",
    market_name: "Receptions", stat_id: "receiving_receptions", side_id: "over",
    line: "5.5", odds: "-110", bookmaker: "fanduel", result_status: "pending",
    grade_source: null, eligibility_at_lock: true, withdrawn_at: null,
    ...overrides
  };
}
function snapshot(slot: "backup" | "primary" = "primary"): SnapshotRecord {
  const p = pick();
  return { submission_id: p.id, season: p.season, week: p.week, team_id: p.team_id,
    snapshot_slot: slot, event_id: p.event_id, market_id: p.market_id,
    sportsbook_player_id: p.sportsbook_player_id, stat_id: p.stat_id,
    side_id: p.side_id, line: "5.5", odds: "-120",
    captured_at: "2026-11-15T17:56:00Z", quote_updated_at: "2026-11-15T17:54:00Z" };
}
function boxscore(value: number, final: boolean, stat = "REC"): EspnNflSummary {
  return {
    header: { competitions: [{ status: { type: { completed: final } } }] },
    boxscore: { players: [{ statistics: [{ name: "receiving", labels: ["REC", "YDS", "TD"], athletes: [
      { athlete: { id: "123" }, stats: [stat === "REC" ? String(value) : "6", stat === "YDS" ? String(value) : "78", "0"] }
    ] }] }] }
  };
}

test("Central-time Sun noon through Mon 3am guard handles both CST and CDT", () => {
  assert.deepEqual(chicagoLiveHitWindow("2026-11-15T18:00:00Z"), { active: true, sundayDate: "2026-11-15" }); // noon CST
  assert.deepEqual(chicagoLiveHitWindow("2026-09-13T17:00:00Z"), { active: true, sundayDate: "2026-09-13" }); // noon CDT
  assert.deepEqual(chicagoLiveHitWindow("2026-11-16T07:00:00Z"), { active: true, sundayDate: "2026-11-15" }); // Mon 1am CST
  assert.equal(chicagoLiveHitWindow("2026-11-16T09:00:00Z").active, false); // Mon 3am CST
  assert.equal(chicagoLiveHitWindow("2026-11-15T17:59:59Z").active, false);
  assert.equal(chicagoLiveHitWindow("2026-11-17T20:00:00Z").active, false);
});

test("requires exact primary snapshot, verified lock, non-manual and verified pro team", () => {
  assert.equal(eligibleLiveHitPick(pick(), [snapshot()]).eligible, true);
  assert.equal(eligibleLiveHitPick(pick(), [snapshot("backup")]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ pro_team_id: null }), [snapshot()]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ eligibility_at_lock: false }), [snapshot()]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ grade_source: "manual" }), [snapshot()]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ result_status: "miss" }), [snapshot()]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ market_id: "substituted-odd" }), [snapshot()]).eligible, false);
  assert.equal(eligibleLiveHitPick(pick({ bookmaker: "other" }), [snapshot()]).eligible, false);
});

test("over becomes provisional hit once threshold crossed; no live grade writes", () => {
  assert.equal(evaluateLiveHit(boxscore(5, false), pick(), "5.5").state, "waiting");
  const six = evaluateLiveHit(boxscore(6, false), pick(), "5.5");
  assert.equal(six.state, "hit");
  assert.equal(six.actualValue, 6);
  assert.equal(six.final, false);
  assert.equal(evaluateLiveHit(boxscore(6, true), pick(), "5.5").state, "hit");
  assert.equal(evaluateLiveHit(boxscore(5, true), pick(), "5.5").state, "waiting");
  assert.equal(evaluateLiveHit(boxscore(6, false), pick(), "6.5").state, "waiting");
  assert.equal(evaluateLiveHit(boxscore(6, false), pick(), null).state, "review");
});

test("under can only alert after final NFL statistics", () => {
  assert.equal(evaluateLiveHit(boxscore(2, false), pick({ side_id: "under" }), "5.5").state, "waiting");
  assert.equal(evaluateLiveHit(boxscore(2, true), pick({ side_id: "under" }), "5.5").state, "hit");
  assert.equal(evaluateLiveHit(boxscore(7, true), pick({ side_id: "under" }), "5.5").state, "waiting");
});

test("missing athlete statistics and anytime-TD zero require review", () => {
  const absent: EspnNflSummary = { header: { competitions: [{ status: { type: { completed: true } } }] }, boxscore: { players: [] } };
  assert.equal(evaluateLiveHit(absent, pick(), "5.5").state, "review");
  const tdYes = pick({ stat_id: "touchdowns", side_id: "yes", line: null });
  const tdSummary: EspnNflSummary = { header: { competitions: [{ status: { type: { completed: false } } }] },
    boxscore: { players: [{ statistics: [
      { name: "rushing", labels: ["TD"], athletes: [{ athlete: { id: 123 }, stats: ["1"] }] },
      { name: "receiving", labels: ["TD"], athletes: [{ athlete: { id: 123 }, stats: ["0"] }] }
    ] }] } };
  assert.equal(evaluateLiveHit(tdSummary, tdYes, null).state, "hit");
  const zero: EspnNflSummary = { ...tdSummary, header: { competitions: [{ status: { type: { completed: true } } }] },
    boxscore: { players: [{ statistics: [
      { name: "rushing", labels: ["TD"], athletes: [{ athlete: { id: 123 }, stats: ["0"] }] },
      { name: "receiving", labels: ["TD"], athletes: [{ athlete: { id: 123 }, stats: ["0"] }] }
    ] }] } };
  assert.equal(evaluateLiveHit(zero, tdYes, null).state, "review");
  assert.equal(evaluateLiveHit(zero, { ...tdYes, side_id: "no" }, null).state, "review");
});

test("push copy explicitly warns live stats are provisional", () => {
  const live = liveHitNotificationCopy(pick(), "5.5", 6, false);
  const finished = liveHitNotificationCopy(pick(), "5.5", 7, true);
  assert.match(live.body, /not yet final/i);
  assert.match(finished.body, /settlement pending/i);
  assert.match(live.body, /5\.5/);
});
