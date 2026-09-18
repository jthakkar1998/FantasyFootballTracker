import { leagueConfig } from "./config";
import type { NflEvent, NflScoreboardResponse, WeekDeadline } from "./types";

const NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

function localParts(iso: string): { date: string; weekday: string } {
  const value = new Date(iso);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: leagueConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const get = (type: string) => dateParts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: leagueConfig.timeZone,
    weekday: "short"
  }).format(value);

  return { date, weekday };
}

async function fetchNflWeekEvents(week: number): Promise<NflEvent[]> {
  const params = new URLSearchParams({
    dates: String(leagueConfig.season),
    seasontype: "2",
    week: String(week),
    limit: "100"
  });

  const response = await fetch(`${NFL_SCOREBOARD}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`NFL schedule request failed (${response.status})`);
  }

  const data = (await response.json()) as NflScoreboardResponse;
  return (data.events ?? [])
    .filter((event) => Boolean(event.date))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function fetchNflWeekDeadline(week: number): Promise<WeekDeadline> {
  const events = await fetchNflWeekEvents(week);

  if (!events.length) {
    throw new Error(`No NFL regular-season events found for week ${week}`);
  }

  const firstKickoff = events[0].date;
  const sundayEvent = events.find((event) => localParts(event.date).weekday === "Sun");

  if (!sundayEvent) {
    throw new Error(`Could not find a Sunday game in NFL week ${week}`);
  }

  return {
    firstKickoff,
    sundayDate: localParts(sundayEvent.date).date
  };
}

export interface NflSundayGame {
  espnEventId: string;
  startsAt: string;
  homeTeamName: string;
  awayTeamName: string;
}

function competitorName(competitor: NonNullable<NonNullable<NflEvent["competitions"]>[number]["competitors"]>[number] | undefined): string {
  return competitor?.team?.displayName ?? competitor?.team?.shortDisplayName ?? competitor?.team?.name ?? "Unknown";
}

export async function fetchNflSundayGameForProTeam(args: {
  week: number;
  sundayDate: string;
  proTeamId: number;
}): Promise<NflSundayGame> {
  const events = await fetchNflWeekEvents(args.week);
  const target = events.find((event) => {
    if (localParts(event.date).date !== args.sundayDate) return false;
    const competitors = event.competitions?.[0]?.competitors ?? [];
    return competitors.some((competitor) => Number(competitor.team?.id) === args.proTeamId);
  });

  if (!target) {
    throw new Error("That player's NFL team is not on Sunday's eligible slate.");
  }

  const competitors = target.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((competitor) => competitor.homeAway === "home");
  const away = competitors.find((competitor) => competitor.homeAway === "away");

  return {
    espnEventId: target.id,
    startsAt: target.date,
    homeTeamName: competitorName(home),
    awayTeamName: competitorName(away)
  };
}
