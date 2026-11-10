import { leagueConfig } from "./config";
import { getCachedOdds, setCachedOdds } from "./parlay-db";
import { nflScheduleCachePolicy, loadCachedNflSchedule } from "./nfl-schedule-policy";
import { verifiedNflSundayDate } from "./nfl-week-calendar";
import type { NflEvent, NflScoreboardResponse, WeekDeadline } from "./types";

const NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

function localParts(iso: string): { date: string; weekday: string } {
  const value = new Date(iso);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: leagueConfig.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const get = (type: string) => dateParts.find(p => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: leagueConfig.timeZone, weekday: "short"
  }).format(value);
  return { date, weekday };
}

/** The verified Sunday is enough to enforce our league's fixed 11:55 AM deadline.
 * It does NOT need a network request. Unknown future seasons use cached ESPN data. */
export async function parlaySundayForWeek(week: number): Promise<string> {
  const known = verifiedNflSundayDate(leagueConfig.season, week);
  if (known) return known;
  const deadline = await fetchNflWeekDeadline(week);
  return deadline.sundayDate;
}

/** Cached across ALL Vercel instances in the existing parlay_odds_cache table.
 * A blocked upstream endpoint can reuse recent, previously validated event IDs.
 * A cold-cache failure still fails closed: never infer an event ID for grading. */
export async function fetchNflWeekEvents(week: number): Promise<NflEvent[]> {
  if (!Number.isInteger(week) || week < 1 || week > 22) throw new Error("Invalid NFL week");
  const cacheKey = `espn:nfl:schedule:v2:${leagueConfig.season}:w${week}`;
  let cached: { payload: NflEvent[]; fetchedAt: string } | null = null;
  try { cached = await getCachedOdds<NflEvent[]>(cacheKey); }
  catch (error) {
    console.warn(`[nfl-schedule] Cache read failed season=${leagueConfig.season} week=${week}:`, error);
  }
  const policy = nflScheduleCachePolicy(verifiedNflSundayDate(leagueConfig.season, week), Date.now());
  return loadCachedNflSchedule({
    cached,
    nowMs: Date.now(),
    policy,
    onWarning: message => console.warn(`[nfl-schedule] season=${leagueConfig.season} week=${week}: ${message}`),
    fetchFresh: async () => {
      const params = new URLSearchParams({
        dates: String(leagueConfig.season), seasontype: "2", week: String(week), limit: "100"
      });
      const response = await fetch(`${NFL_SCOREBOARD}?${params.toString()}`, {
        headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`NFL schedule request failed (${response.status})`);
      const data = (await response.json()) as NflScoreboardResponse;
      return (data.events ?? [])
        .filter(event => Boolean(event.date) && (event.competitions?.[0]?.competitors ?? []).length === 2)
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    },
    saveFresh: (events, fetchedAt) => setCachedOdds(cacheKey, events, fetchedAt)
  });
}

/** Used by recap/penalty syncing, where the real first game start matters. */
export async function fetchNflWeekDeadline(week: number): Promise<WeekDeadline> {
  const events = await fetchNflWeekEvents(week);
  if (!events.length) throw new Error(`No NFL regular-season events found for week ${week}`);
  const firstKickoff = events[0].date;
  const sunday = events.find(event => localParts(event.date).weekday === "Sun");
  if (!sunday) throw new Error(`Could not find Sunday in NFL week ${week}`);
  return { firstKickoff, sundayDate: localParts(sunday.date).date };
}

// ESPN NFL pro-team schedule lookup remains available for internal diagnostics;
// the new FanDuel selection workflow no longer requires it.
export interface NflSundayGame {
  espnEventId: string;
  startsAt: string;
  homeTeamName: string;
  awayTeamName: string;
}
function competitorName(competitor: NonNullable<NonNullable<NflEvent["competitions"]>[number]["competitors"]>[number] | undefined): string {
  return competitor?.team?.displayName ?? competitor?.team?.shortDisplayName ?? competitor?.team?.name ?? "Unknown";
}
export async function fetchNflSundayGameForProTeam(args: {week: number; sundayDate: string; proTeamId: number}): Promise<NflSundayGame> {
  const events = await fetchNflWeekEvents(args.week);
  const target = events.find(event => localParts(event.date).date === args.sundayDate &&
    (event.competitions?.[0]?.competitors ?? []).some(c => Number(c.team?.id) === args.proTeamId));
  if (!target) throw new Error("That player's NFL team is not on Sunday's eligible slate.");
  const competitors = target.competitions?.[0]?.competitors ?? [];
  return {
    espnEventId: target.id, startsAt: target.date,
    homeTeamName: competitorName(competitors.find(c => c.homeAway === "home")),
    awayTeamName: competitorName(competitors.find(c => c.homeAway === "away"))
  };
}
