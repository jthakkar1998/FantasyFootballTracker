import { chooseGradingSnapshot, type SnapshotRecord } from "./parlay-snapshot-core";
import {
  extractEspnNflMetric, gradeStat, isNflBoxscoreFinal, makeBaseGradeDecision,
  type EspnNflSummary, type GradingPick
} from "./parlay-grade-core";

export interface LiveHitPick extends GradingPick {
  pro_team_id: number | null;
}

export type LiveHitState = "hit" | "waiting" | "review";
export interface LiveHitVerdict {
  state: LiveHitState;
  actualValue: number | null;
  final: boolean;
  reason: string;
}

export function chicagoLiveHitWindow(nowIso: string): { active: boolean; sundayDate: string | null } {
  const instant = new Date(nowIso);
  if (!Number.isFinite(instant.getTime())) return { active: false, sundayDate: null };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(instant);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = Number(part("hour"));
  if (part("weekday") === "Sun" && hour >= 12) return { active: true, sundayDate: day };
  if (part("weekday") === "Mon" && hour < 3) {
    const previous = new Date(`${day}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return { active: true, sundayDate: previous.toISOString().slice(0, 10) };
  }
  return { active: false, sundayDate: null };
}

export function chicagoDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function eligibleLiveHitPick(pick: LiveHitPick, snapshots: SnapshotRecord[]): {
  eligible: boolean; line: string | null; reason: string;
} {
  const preliminary = makeBaseGradeDecision(pick, snapshots);
  if (preliminary.status !== "ready") return { eligible: false, line: null, reason: preliminary.reason };
  const chosen = chooseGradingSnapshot(pick, snapshots);
  if (!chosen.selected || chosen.source !== "primary") return { eligible: false, line: null, reason: "No matching 11:56 primary snapshot." };
  if (!Number.isInteger(pick.pro_team_id) || Number(pick.pro_team_id) <= 0) {
    return { eligible: false, line: null, reason: "Missing verified NFL team ID (older picks are not retroactively alerted)." };
  }
  if (pick.side_id !== "over" && pick.side_id !== "under" && pick.side_id !== "yes" && pick.side_id !== "no") {
    return { eligible: false, line: null, reason: "Unsupported sportsbook side." };
  }
  return { eligible: true, line: chosen.selected.line, reason: "Eligible Sunday pick with 11:56 primary snapshot." };
}

/** Live hit alerts are informational. Never write Hit/Miss/Push to the bet row here.
 * Unders and No picks cannot win before the game is officially final.
 * Missing statistics are never treated as zero (DNP/void cases need review). */
export function evaluateLiveHit(summary: EspnNflSummary, pick: LiveHitPick, line: string | null): LiveHitVerdict {
  const final = isNflBoxscoreFinal(summary);
  const metric = extractEspnNflMetric(summary, pick.espn_player_id, pick.stat_id);
  if (metric.value === null) {
    return { state: "review", actualValue: null, final, reason: metric.reason ?? "NFL player statistics unavailable." };
  }
  const comparison = gradeStat({ statId: pick.stat_id, side: pick.side_id, line, value: metric.value,
    possibleOtherTouchdowns: metric.possibleOtherTouchdowns });
  if (!comparison.result) return { state: "review", actualValue: metric.value, final, reason: comparison.reason };
  if ((pick.side_id === "under" || pick.side_id === "no") && !final) {
    return { state: "waiting", actualValue: metric.value, final, reason: "Under/No requires a final NFL game." };
  }
  if (comparison.result !== "hit") {
    return { state: "waiting", actualValue: metric.value, final, reason: final ? "Final box score does not indicate a win." : "Line not currently cleared." };
  }
  return { state: "hit", actualValue: metric.value, final, reason: final ? "Hit according to final ESPN NFL statistics (not sportsbook settlement)." : "Currently clearing the line; provisional pending final NFL stats." };
}

export function liveHitNotificationCopy(pick: LiveHitPick, line: string | null, value: number, final: boolean): { title: string; body: string } {
  const description = `${pick.side_id.toUpperCase()}${line === null ? "" : ` ${line}`} ${pick.stat_id.replaceAll("_", " ").replaceAll("+", " + ")}`;
  return {
    title: final ? "Your parlay leg looks like a hit!" : "Your parlay leg is currently hitting!",
    body: `${pick.player_name}: ${description} (NFL stat: ${value}). ${final ? "Final ESPN stats; sportsbook settlement pending." : "Live ESPN stats; not yet final."}`
  };
}
