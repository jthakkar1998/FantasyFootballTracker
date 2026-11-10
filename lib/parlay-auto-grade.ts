import { leagueConfig } from "./config";
import { fetchWeekBoxscore } from "./espn";
import { fetchNflWeekEvents } from "./nfl";
import { listParlayHistory } from "./parlay-db";
import { listSnapshots } from "./parlay-snapshot-db";
import { getDb } from "./supabase";
import { extractEspnNflMetric, gradeStat, isNflBoxscoreFinal, makeBaseGradeDecision, isPotentialGradeInstant, type EspnNflSummary, type GradeDecision, type GradingPick } from "./parlay-grade-core";
import type { EspnMatchupSide, NflEvent } from "./types";

const ESPN_NFL_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const MIN_WEEK = Number(process.env.PARLAY_AUTO_GRADING_MIN_WEEK ?? "9");

function n(v: unknown): number | null {
  const parsed = Number(v);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}


async function fetchFinalNflSummary(eventId: string): Promise<EspnNflSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${ESPN_NFL_SUMMARY_URL}?${new URLSearchParams({ event: eventId })}`, {
      headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal
    });
    if (!response.ok) throw new Error(`NFL summary HTTP ${response.status}`);
    return await response.json() as EspnNflSummary;
  } finally { clearTimeout(timer); }
}

function proTeamForPlayer(boxscore: Awaited<ReturnType<typeof fetchWeekBoxscore>>, playerId: number): number | null {
  for (const matchup of boxscore.schedule ?? []) {
    for (const side of [matchup.home, matchup.away] as Array<EspnMatchupSide | undefined>) {
      for (const entry of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
        if (entry.playerId === playerId) return n(entry.playerPoolEntry?.player?.proTeamId);
      }
    }
  }
  return null;
}

function nflGameForTeam(events: NflEvent[], teamId: number, eventStartsAt: string): NflEvent | null {
  const matching = events.filter(event =>
    (event.competitions?.[0]?.competitors ?? []).some(c => Number(c.team?.id) === teamId) &&
    Number.isFinite(Date.parse(eventStartsAt)) && Number.isFinite(Date.parse(event.date)) &&
    Math.abs(Date.parse(event.date) - Date.parse(eventStartsAt)) < 3 * 60 * 60 * 1000
  );
  return matching.length === 1 ? matching[0] : null;
}

export interface GradingPreview {
  status: "preview" | "applied" | "disabled" | "no_window" | "empty";
  season: number;
  week: number | null;
  total: number;
  ready: number;
  review: number;
  alreadyGraded: number;
  applied: number;
  decisions: GradeDecision[];
  note: string;
  errors: string[];
}

/** Preview ALWAYS reads only. Application is independently gated by env flag,
 * a Monday/Tuesday time guard, manual-override guard, and conditional DB update. */
export async function runAutoGrading(args: { dryRun: boolean; week?: number; nowIso?: string; commissionerApply?: boolean }): Promise<GradingPreview> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const empty = (status: GradingPreview["status"], reason: string): GradingPreview => ({
    status, season: leagueConfig.season, week: args.week ?? null, total: 0,
    ready: 0, review: 0, alreadyGraded: 0, applied: 0, decisions: [], errors: [], note: reason
  });
  if (!args.dryRun && process.env.PARLAY_AUTO_GRADING_ENABLED !== "true") {
    return empty("disabled", "Automatic result writes are off. Preview remains available.");
  }
  if (!args.dryRun && args.commissionerApply && args.week === undefined) {
    throw new Error("Commissioner-initiated write requires an explicit week.");
  }
  if (!args.dryRun && !args.commissionerApply && !isPotentialGradeInstant(nowIso)) {
    return empty("no_window", "Only scheduled Monday/Tuesday 9:15–9:50 AM Central runs may write grades.");
  }
  if (!Number.isInteger(MIN_WEEK) || MIN_WEEK < 1 || MIN_WEEK > 22) throw new Error("Invalid PARLAY_AUTO_GRADING_MIN_WEEK.");
  if (args.week !== undefined && (!Number.isInteger(args.week) || args.week < MIN_WEEK || args.week > 22)) {
    throw new Error(`Select a week between ${MIN_WEEK} and 22.`);
  }
  const allPicks = (await listParlayHistory(leagueConfig.season)) as GradingPick[];
  const snapshots = await listSnapshots(leagueConfig.season);
  const capturedWeeks = [...new Set(snapshots.filter(s => s.week >= MIN_WEEK).map(s => s.week))].sort((a, b) => b - a);
  const week = args.week ?? capturedWeeks[0];
  if (!week) return empty("empty", "No Sunday snapshots exist at or after the auto-grading start week.");
  const picks = allPicks.filter(p => p.week === week && !p.withdrawn_at);
  if (!picks.length) return { ...empty("empty", "No active website picks for this week."), week };
  const decisions = picks.map(p => makeBaseGradeDecision(p, snapshots.filter(s => s.week === week)));
  const candidates = picks.filter((_, i) => decisions[i].status === "ready");
  const errors: string[] = [];

  if (candidates.length) {
    let boxscore: Awaited<ReturnType<typeof fetchWeekBoxscore>> | null = null;
    let events: NflEvent[] = [];
    try {
      [boxscore, events] = await Promise.all([fetchWeekBoxscore(week), fetchNflWeekEvents(week)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown ESPN NFL lookup error";
      errors.push(message);
      for (const item of decisions.filter(d => d.status === "ready")) {
        item.status = "review"; item.reason = `NFL schedule or fantasy roster unavailable: ${message}`;
      }
    }
    if (boxscore) {
      const eventIds = new Map<string, string>();
      for (const pick of candidates) {
        const item = decisions.find(d => d.submissionId === pick.id)!;
        const proTeamId = proTeamForPlayer(boxscore, pick.espn_player_id);
        if (!proTeamId) {
          item.status = "review"; item.reason = "Could not verify the ESPN NFL team for this player in the Week's fantasy box score."; continue;
        }
        const nflEvent = nflGameForTeam(events, proTeamId, pick.event_starts_at);
        if (!nflEvent) {
          item.status = "review"; item.reason = "Could not uniquely verify player's NFL game and kickoff time."; continue;
        }
        eventIds.set(pick.id, nflEvent.id);
      }
      const uniqueEvents = [...new Set(eventIds.values())];
      // Fetch once per game, not once per pick. Concurrency cap protects the
      // ESPN public endpoint and Vercel request duration.
      const summaries = new Map<string, EspnNflSummary | Error>();
      for (let i = 0; i < uniqueEvents.length; i += 4) {
        await Promise.all(uniqueEvents.slice(i, i + 4).map(async eventId => {
          try { summaries.set(eventId, await fetchFinalNflSummary(eventId)); }
          catch (error) { summaries.set(eventId, error instanceof Error ? error : new Error("NFL summary fetch failed.")); }
        }));
      }
      for (const pick of candidates) {
        const item = decisions.find(d => d.submissionId === pick.id)!;
        if (item.status !== "ready") continue;
        const eventId = eventIds.get(pick.id)!;
        item.nflEventId = eventId;
        const summary = summaries.get(eventId);
        if (!summary || summary instanceof Error) {
          item.status = "review";
          item.reason = summary instanceof Error ? `NFL game data unavailable: ${summary.message}` : "NFL game not found.";
          continue;
        }
        if (!isNflBoxscoreFinal(summary)) {
          item.status = "review"; item.reason = "NFL game not officially marked final; do not grade."; continue;
        }
        const metric = extractEspnNflMetric(summary, pick.espn_player_id, pick.stat_id);
        if (metric.value === null) {
          item.status = "review"; item.reason = metric.reason ?? "Verified NFL statistic unavailable."; continue;
        }
        item.actualValue = metric.value;
        const comparison = gradeStat({ statId: pick.stat_id, side: pick.side_id, line: item.line,
          value: metric.value, possibleOtherTouchdowns: metric.possibleOtherTouchdowns });
        if (!comparison.result) {
          item.status = "review"; item.reason = comparison.reason; continue;
        }
        item.predictedResult = comparison.result;
        item.reason = comparison.reason;
      }
    }
  }

  let applied = 0;
  if (!args.dryRun) {
    for (const item of decisions.filter(d => d.status === "ready" && d.predictedResult)) {
      const pick = picks.find(p => p.id === item.submissionId)!;
      // Do not clobber commissioner/manual grades, withdrawn entries, changed
      // player/market/side, payment fields, or other members' history.
      const { data, error } = await getDb().from("parlay_submissions")
        .update({ result_status: item.predictedResult, graded_at: nowIso, grade_source: "auto" })
        .eq("id", item.submissionId).eq("season", pick.season).eq("week", pick.week)
        .eq("event_id", pick.event_id).eq("market_id", pick.market_id)
        .eq("sportsbook_player_id", pick.sportsbook_player_id).eq("stat_id", pick.stat_id)
        .eq("side_id", pick.side_id).eq("result_status", "pending")
        .is("grade_source", null).is("withdrawn_at", null)
        .select("id");
      if (error) {
        item.status = "review"; item.reason = `Database did not accept auto-grade: ${error.message}`;
        errors.push(`${pick.team_name}: ${error.message}`);
      } else if ((data ?? []).length === 1) {
        applied++;
      } else {
        item.status = "already_graded";
        item.reason = "Skipped: record was changed or graded by the commissioner during this run.";
      }
    }
    const { error: logError } = await getDb().from("parlay_auto_grade_runs").insert({
      season: leagueConfig.season, week, finished_at: new Date().toISOString(),
      run_source: args.commissionerApply ? "commissioner" : "cron",
      status: errors.length ? "partial" : "success", total: decisions.length,
      ready: decisions.filter(d => d.status === "ready").length,
      review: decisions.filter(d => d.status === "review").length,
      already_graded: decisions.filter(d => d.status === "already_graded").length,
      applied, errors, decisions
    });
    if (logError) errors.push(`Audit log failed: ${logError.message}`);
  }
  return {
    status: args.dryRun ? "preview" : "applied", season: leagueConfig.season, week,
    total: decisions.length, ready: decisions.filter(d => d.status === "ready").length,
    review: decisions.filter(d => d.status === "review").length,
    alreadyGraded: decisions.filter(d => d.status === "already_graded").length,
    applied, decisions, errors,
    note: args.dryRun ? "Read-only preview. No FanDuel calls, writes, payments, or official grades changed." :
      "Only pending, unmodified website picks with valid primary snapshots and final NFL stats were automatically graded."
  };
}
