import { chooseGradingSnapshot, type SnapshotPick, type SnapshotRecord } from "./parlay-snapshot-core";

/** These decisions are independent of the ESPN fantasy league's power rankings and
 * of sportsbook settlement. We use FINAL NFL box-score statistics for grading.
 * Ambiguous, missing, DNP, cancelled, and backup-only cases go to review. */
export type AutoGradeResult = "hit" | "miss" | "push";
export type GradeDecisionStatus = "ready" | "review" | "already_graded";

export interface GradingPick extends SnapshotPick {
  espn_player_id: number;
  result_status: "pending" | "hit" | "miss" | "push" | "void";
  grade_source?: "auto" | "manual" | null;
  eligibility_at_lock?: boolean | null;
  withdrawn_at?: string | null;
}

export interface GradeDecision {
  submissionId: string;
  season: number;
  week: number;
  teamId: number;
  team: string;
  player: string;
  statId: string;
  side: string;
  line: string | null;
  source: "primary" | "backup" | "missing";
  status: GradeDecisionStatus;
  predictedResult: AutoGradeResult | null;
  actualValue: number | null;
  reason: string;
  nflEventId: string | null;
}

interface NflAthlete { athlete?: { id?: string | number; displayName?: string }; stats?: Array<string | number> }
interface NflStatGroup { name?: string; labels?: string[]; keys?: string[]; athletes?: NflAthlete[] }
export interface EspnNflSummary {
  header?: { competitions?: Array<{ status?: { type?: { completed?: boolean; name?: string } } }> };
  boxscore?: { players?: Array<{ statistics?: NflStatGroup[] }> };
}

function token(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function numerical(value: string | number | undefined, numerator = false): number | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (numerator && /^\d+\s*\/\s*\d+$/.test(raw)) return Number(raw.split("/")[0].trim());
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Strictly identify the SAME ESPN NFL athlete ID; name-only matching risks misgrading. */
function statValue(summary: EspnNflSummary, playerId: number, category: string, aliases: string[], numerator = false): number | null {
  for (const team of summary.boxscore?.players ?? []) {
    for (const group of team.statistics ?? []) {
      if (token(group.name ?? "") !== token(category)) continue;
      const labels = group.labels ?? [];
      const keys = group.keys ?? [];
      const index = [...Array(Math.max(labels.length, keys.length)).keys()].find(i =>
        aliases.some(alias => token(labels[i] ?? "") === token(alias) || token(keys[i] ?? "") === token(alias)));
      if (index === undefined) continue;
      const athlete = (group.athletes ?? []).find(row => String(row.athlete?.id ?? "") === String(playerId));
      if (!athlete) continue;
      return numerical(athlete.stats?.[index], numerator);
    }
  }
  return null;
}

export function extractEspnNflMetric(summary: EspnNflSummary, playerId: number, statId: string): { value: number | null; reason: string | null; possibleOtherTouchdowns?: boolean } {
  const read = (category: string, aliases: string[], numerator = false) => statValue(summary, playerId, category, aliases, numerator);
  const metrics: Record<string, [string, string[], boolean?]> = {
    passing_yards: ["passing", ["YDS", "passingYards"]],
    passing_touchdowns: ["passing", ["TD", "passingTouchdowns"]],
    passing_completions: ["passing", ["C/ATT", "completionsAttempts"], true],
    passing_attempts: ["passing", ["C/ATT", "completionsAttempts"]],
    passing_interceptions: ["passing", ["INT", "interceptions"]],
    rushing_yards: ["rushing", ["YDS", "rushingYards"]],
    rushing_attempts: ["rushing", ["CAR", "rushingAttempts"]],
    rushing_touchdowns: ["rushing", ["TD", "rushingTouchdowns"]],
    receiving_yards: ["receiving", ["YDS", "receivingYards"]],
    receiving_receptions: ["receiving", ["REC", "receptions"]],
    receiving_touchdowns: ["receiving", ["TD", "receivingTouchdowns"]],
    receiving_longestReception: ["receiving", ["LNG", "longReception"]],
    fieldGoals_made: ["kicking", ["FG", "FG-FGA", "fieldGoalsMadeAttempts"], true],
    extraPoints_kicksMade: ["kicking", ["XP", "XP-XPA", "extraPointsMadeAttempts"], true]
  };
  if (statId === "touchdowns" || statId === "rushing+receiving_yards") {
    const suffix = statId === "touchdowns" ? "touchdowns" : "yards";
    const rushing = read("rushing", suffix === "touchdowns" ? ["TD", "rushingTouchdowns"] : ["YDS", "rushingYards"]);
    const receiving = read("receiving", suffix === "touchdowns" ? ["TD", "receivingTouchdowns"] : ["YDS", "receivingYards"]);
    if (rushing === null && receiving === null) return { value: null, reason: "Neither rushing nor receiving statistics were reported for this athlete." };
    // ESPN may omit a stat category when the player has zero opportunities.
    // A positive stat in the other category is still reliable for an anytime-TD hit.
    if (rushing === null || receiving === null) {
      if (statId === "touchdowns" && (rushing ?? receiving ?? 0) >= 1) {
        return { value: rushing ?? receiving, reason: null, possibleOtherTouchdowns: true };
      }
      return { value: null, reason: "One component is absent; cannot assume it was zero." };
    }
    return { value: rushing + receiving, reason: null, possibleOtherTouchdowns: statId === "touchdowns" };
  }
  if (statId === "kicking_totalPoints") {
    const fg = read("kicking", ["FG", "FG-FGA"], true);
    const xp = read("kicking", ["XP", "XP-XPA"], true);
    if (fg === null || xp === null) return { value: null, reason: "Complete kicking statistics unavailable." };
    return { value: fg * 3 + xp, reason: null };
  }
  if (statId === "passing_attempts") {
    for (const row of summary.boxscore?.players ?? []) for (const group of row.statistics ?? []) {
      if (token(group.name ?? "") !== "passing") continue;
      const index = (group.labels ?? []).findIndex(s => token(s) === "catt");
      const athlete = (group.athletes ?? []).find(a => String(a.athlete?.id ?? "") === String(playerId));
      if (index >= 0 && athlete) {
        const raw = String(athlete.stats?.[index] ?? "");
        if (/^\d+\s*\/\s*\d+$/.test(raw)) return { value: Number(raw.split("/")[1]), reason: null };
      }
    }
    return { value: null, reason: "Passing attempts not available in ESPN's C/ATT column." };
  }
  const entry = metrics[statId];
  if (!entry) return { value: null, reason: `Unsupported prop statistic: ${statId}.` };
  const value = read(entry[0], entry[1], entry[2]);
  return { value, reason: value === null ? `Verified ${entry[0]} statistic is missing for ESPN athlete ${playerId}.` : null };
}

export function isNflBoxscoreFinal(summary: EspnNflSummary): boolean {
  return summary.header?.competitions?.[0]?.status?.type?.completed === true;
}

export function gradeStat(args: { statId: string; side: string; line: string | null; value: number; possibleOtherTouchdowns?: boolean }): { result: AutoGradeResult | null; reason: string } {
  const { side, line, value, statId } = args;
  if (!Number.isFinite(value) || value < 0) return { result: null, reason: "Invalid NFL statistic." };
  if (side === "over" || side === "under") {
    if (line === null || line.trim() === "" || !Number.isFinite(Number(line))) return { result: null, reason: "No valid numeric primary FanDuel line." };
    const target = Number(line);
    if (target < 0) return { result: null, reason: "Invalid negative FanDuel line." };
    // ESPN's positive yardage, receptions, and touchdowns stats are integers;
    // a whole-number line can legitimately push.
    const delta = value - target;
    return { result: delta === 0 ? "push" : (side === "over" ? delta > 0 : delta < 0) ? "hit" : "miss", reason: "Final ESPN NFL box score vs. primary FanDuel line." };
  }
  if (side === "yes" || side === "no") {
    if (line !== null) return { result: null, reason: "Yes/No market unexpectedly has a numeric line." };
    if (!Number.isInteger(value)) return { result: null, reason: "Yes/No touchdown markets require integer counts." };
    // Anytime touchdown can include fumble, kickoff, or punt return scores.
    // A rushing/receiving TD proves Yes, but zero does NOT prove No.
    if (statId === "touchdowns" && value === 0) return { result: null, reason: "Anytime touchdown with zero rushing/receiving TDs needs commissioner review for return or fumble TDs." };
    const happened = value >= 1;
    return { result: (side === "yes" ? happened : !happened) ? "hit" : "miss", reason: "Final ESPN NFL touchdown count (subject to market definition)." };
  }
  return { result: null, reason: `Unsupported bet side: ${side}.` };
}

export function makeBaseGradeDecision(pick: GradingPick, snapshots: SnapshotRecord[]): GradeDecision {
  const selected = chooseGradingSnapshot(pick, snapshots);
  const base: GradeDecision = {
    submissionId: pick.id, season: pick.season, week: pick.week, teamId: pick.team_id,
    team: pick.team_name, player: pick.player_name, statId: pick.stat_id,
    side: pick.side_id, line: selected.selected?.line ?? null, source: selected.source,
    status: "review", predictedResult: null, actualValue: null, reason: "", nflEventId: null
  };
  if (pick.result_status !== "pending" || pick.grade_source === "manual") {
    return { ...base, status: "already_graded", reason: pick.grade_source === "manual" ? "Commissioner-managed result (never auto-overwrite)." : `Already ${pick.result_status}.` };
  }
  if (pick.withdrawn_at) return { ...base, reason: "Withdrawn pick; never auto-grade." };
  if (pick.bookmaker.toLowerCase() !== "fanduel") return { ...base, reason: "Not a FanDuel website selection." };
  if (pick.eligibility_at_lock !== true) return { ...base, reason: pick.eligibility_at_lock === false ? "Player failed eligibility check at Sunday lock." : "Sunday eligibility lock not confirmed." };
  if (selected.source === "missing") return { ...base, reason: "No matching Sunday snapshot for this pick." };
  if (selected.source === "backup") return { ...base, reason: "Only 11:45 backup exists; commissioner approval required before grading." };
  return { ...base, status: "ready", reason: "Awaiting final NFL statistic." };
}

export function isPotentialGradeInstant(nowIso: string): boolean {
  const date = new Date(nowIso);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  return (part("weekday") === "Mon" || part("weekday") === "Tue") &&
    Number(part("hour")) === 9 && Number(part("minute")) >= 15 && Number(part("minute")) <= 50;
}
