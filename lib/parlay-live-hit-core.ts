import { chooseGradingSnapshot, type SnapshotRecord } from "./parlay-snapshot-core";
import {
  extractEspnNflMetric, gradeStat, isNflBoxscoreFinal,
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
  if (part("weekday") === "Sun" && (hour > 8 || (hour === 8 && Number(part("minute")) >= 15))) return { active: true, sundayDate: day };
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
  const chosen = chooseGradingSnapshot(pick, snapshots);
  if (pick.withdrawn_at || pick.result_status === "miss" || pick.result_status === "void" ||
      pick.grade_source === "manual" || pick.bookmaker.toLowerCase() !== "fanduel") {
    return { eligible: false, line: null, reason: "Withdrawn, settled, manual, or non-FanDuel selection." };
  }
  if (!chosen.selected) return { eligible: false, line: null, reason: "No matching verified pregame snapshot." };
  const kickoff = new Date(pick.event_starts_at);
  const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(kickoff);
  const h = Number(local.find(p => p.type === "hour")?.value ?? -1);
  const m = Number(local.find(p => p.type === "minute")?.value ?? -1);
  const earlyGame = h < 11 || (h === 11 && m < 56);
  if (chosen.source !== "primary" && !earlyGame) return {
    eligible: false, line: null, reason: "Primary snapshot required for games starting after 11:56 AM Central." };
  // Early games begin before the normal Sunday lock, so verified submission
  // snapshots may safely participate without fabricating a lock flag.
  if (pick.eligibility_at_lock === false || (pick.eligibility_at_lock !== true && !earlyGame)) {
    return { eligible: false, line: null, reason: "Sunday starter eligibility has not been verified." };
  }
  if (!Number.isInteger(pick.pro_team_id) || Number(pick.pro_team_id) <= 0) return {
    eligible: false, line: null, reason: "Missing verified ESPN NFL team." };
  if (!["over", "under", "yes", "no"].includes(pick.side_id)) return {
    eligible: false, line: null, reason: "Unsupported prop side." };
  return { eligible: true, line: chosen.selected.line, reason: `Verified pregame ${chosen.source} snapshot.` };
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
