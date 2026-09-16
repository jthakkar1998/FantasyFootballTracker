import { leagueConfig } from "./config";
import type { NflScoreboardResponse, WeekDeadline } from "./types";

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

export async function fetchNflWeekDeadline(week: number): Promise<WeekDeadline> {
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
  const events = (data.events ?? [])
    .filter((event) => Boolean(event.date))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
