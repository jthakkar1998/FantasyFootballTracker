import { leagueConfig, slotLabel } from "./config";
import { fetchLeagueSummary, fetchWeekBoxscore, teamDisplayName } from "./espn";
import { fetchNflWeekDeadline } from "./nfl";
import { parlayDeadlineIso } from "./parlay-time";
import type { EspnMatchupSide, EspnRosterEntry, EspnTeam } from "./types";
import type { EligibleParlayPlayer, ParlayTeamContext, ParlayWeekContext } from "./parlay-types";

const POSITION_LABELS: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "D/ST"
};

function playerPosition(entry: EspnRosterEntry): string {
  const defaultPosition = entry.playerPoolEntry?.player?.defaultPositionId;
  if (defaultPosition && POSITION_LABELS[defaultPosition]) return POSITION_LABELS[defaultPosition];
  const slot = slotLabel(entry.lineupSlotId);
  if (slot === "FLEX" || slot === "RB/WR" || slot === "WR/TE" || slot === "OP") return "FLEX";
  return slot;
}

function eligibleStarter(entry: EspnRosterEntry): EligibleParlayPlayer | null {
  if (leagueConfig.benchSlotIds.has(entry.lineupSlotId)) return null;
  if (entry.lineupSlotId === 16) return null; // D/ST is not an individual player prop.
  const player = entry.playerPoolEntry?.player;
  const name = player?.fullName?.trim();
  if (!name) return null;
  if (player?.defaultPositionId === 16) return null;
  return {
    espnPlayerId: entry.playerId,
    name,
    position: playerPosition(entry),
    lineupSlotId: entry.lineupSlotId,
    proTeamId: player?.proTeamId ?? null
  };
}

function sideForTeam(matchup: { home?: EspnMatchupSide; away?: EspnMatchupSide }, teamId: number): EspnMatchupSide | null {
  if (matchup.home?.teamId === teamId) return matchup.home;
  if (matchup.away?.teamId === teamId) return matchup.away;
  return null;
}

function opponentSideForTeam(matchup: { home?: EspnMatchupSide; away?: EspnMatchupSide }, teamId: number): EspnMatchupSide | null {
  if (matchup.home?.teamId === teamId) return matchup.away ?? null;
  if (matchup.away?.teamId === teamId) return matchup.home ?? null;
  return null;
}

function teamMap(teams: EspnTeam[]): Map<number, EspnTeam> {
  return new Map(teams.map((team) => [team.id, team]));
}

export async function getCurrentParlayContext(): Promise<ParlayWeekContext> {
  const summary = await fetchLeagueSummary();
  const week = Number(summary.status?.currentMatchupPeriod ?? summary.scoringPeriodId ?? summary.status?.latestScoringPeriod ?? 1);
  if (!Number.isFinite(week) || week < 1) throw new Error("Could not determine the current ESPN fantasy week.");

  const boxscore = await fetchWeekBoxscore(week);
  const deadlines = await fetchNflWeekDeadline(week);
  const deadlineAt = parlayDeadlineIso(deadlines.sundayDate);
  const teams = summary.teams ?? [];
  const teamsById = teamMap(teams);
  const weekMatchups = (boxscore.schedule ?? summary.schedule ?? []).filter((matchup) => Number(matchup.matchupPeriodId) === week);

  const contexts: ParlayTeamContext[] = [];
  for (const team of teams) {
    const matchup = weekMatchups.find((candidate) => Boolean(sideForTeam(candidate, team.id)));
    if (!matchup) continue;
    const opponent = opponentSideForTeam(matchup, team.id);
    if (!opponent) continue;
    const opponentTeam = teamsById.get(opponent.teamId);
    const eligiblePlayers = (opponent.rosterForCurrentScoringPeriod?.entries ?? [])
      .map(eligibleStarter)
      .filter((player): player is EligibleParlayPlayer => Boolean(player))
      .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

    contexts.push({
      teamId: team.id,
      teamName: teamDisplayName(team, team.id),
      teamLogo: team.logo ?? null,
      opponentTeamId: opponent.teamId,
      opponentTeamName: teamDisplayName(opponentTeam, opponent.teamId),
      eligiblePlayers
    });
  }

  return {
    season: leagueConfig.season,
    week,
    sundayDate: deadlines.sundayDate,
    deadlineAt,
    locked: Date.now() >= new Date(deadlineAt).getTime(),
    teams: contexts.sort((a, b) => a.teamName.localeCompare(b.teamName))
  };
}

export function getTeamContext(context: ParlayWeekContext, teamId: number): ParlayTeamContext {
  const team = context.teams.find((item) => item.teamId === teamId);
  if (!team) throw new Error("Fantasy team is not part of the current matchup slate.");
  return team;
}

export function getEligiblePlayer(context: ParlayWeekContext, teamId: number, espnPlayerId: number): EligibleParlayPlayer {
  const team = getTeamContext(context, teamId);
  const player = team.eligiblePlayers.find((item) => item.espnPlayerId === espnPlayerId);
  if (!player) throw new Error("That player is no longer in your opponent's current starting lineup.");
  return player;
}
