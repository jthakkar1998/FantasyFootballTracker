import { leagueConfig } from "./config";
import type { EspnLeagueResponse, EspnTeam } from "./types";

const BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

async function espnFetch(params: URLSearchParams): Promise<EspnLeagueResponse> {
  const url = `${BASE}/seasons/${leagueConfig.season}/segments/0/leagues/${leagueConfig.leagueId}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "fantasy-punishment-dashboard/1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ESPN request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  return response.json() as Promise<EspnLeagueResponse>;
}

export async function fetchLeagueSummary(): Promise<EspnLeagueResponse> {
  const params = new URLSearchParams();
  params.append("view", "mTeam");
  params.append("view", "mSettings");
  params.append("view", "mStatus");
  params.append("view", "mMatchupScore");
  return espnFetch(params);
}

export async function fetchWeekBoxscore(week: number): Promise<EspnLeagueResponse> {
  const params = new URLSearchParams();
  params.append("view", "mBoxscore");
  params.append("view", "mMatchupScore");
  params.set("matchupPeriodId", String(week));
  params.set("scoringPeriodId", String(week));
  return espnFetch(params);
}

export function teamDisplayName(team: EspnTeam | undefined, teamId: number): string {
  if (!team) return `Team ${teamId}`;
  if (team.name?.trim()) return team.name.trim();
  const composite = [team.location, team.nickname].filter(Boolean).join(" ").trim();
  return composite || team.abbrev || `Team ${teamId}`;
}
