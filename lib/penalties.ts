import { leagueConfig, slotLabel } from "./config";
import { teamDisplayName } from "./espn";
import type {
  EspnLeagueResponse,
  EspnMatchupSide,
  EspnRosterEntry,
  EspnTeam,
  ObligationInsert,
  WeekDeadline
} from "./types";

const EPSILON = 0.000001;

export function isWeekFinal(matchups: EspnLeagueResponse["schedule"], week: number): boolean {
  const weekMatchups = (matchups ?? []).filter((m) => m.matchupPeriodId === week);
  return weekMatchups.length > 0 && weekMatchups.every((m) => m.winner && m.winner !== "UNDECIDED");
}

export function getEntryPoints(entry: EspnRosterEntry, week: number): number | null {
  const direct = entry.playerPoolEntry?.appliedStatTotal;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;

  const stats = entry.playerPoolEntry?.player?.stats ?? [];
  const exactActual = stats.find(
    (stat) => stat.scoringPeriodId === week && stat.statSourceId === 0 && typeof stat.appliedTotal === "number"
  );
  if (typeof exactActual?.appliedTotal === "number") return exactActual.appliedTotal;

  const exact = stats.find(
    (stat) => stat.scoringPeriodId === week && typeof stat.appliedTotal === "number"
  );
  return typeof exact?.appliedTotal === "number" ? exact.appliedTotal : null;
}

function teamMeta(teamsById: Map<number, EspnTeam>, teamId: number) {
  const team = teamsById.get(teamId);
  return {
    teamName: teamDisplayName(team, teamId),
    teamLogo: team?.logo ?? null
  };
}

function activeStarterSlotCounts(lineupSlotCounts: Record<string, number>): Array<[number, number]> {
  return Object.entries(lineupSlotCounts)
    .map(([slotId, count]) => [Number(slotId), Number(count)] as [number, number])
    .filter(([slotId, count]) => count > 0 && !leagueConfig.benchSlotIds.has(slotId));
}

function generateTeamPlayerObligations(args: {
  season: number;
  week: number;
  side: EspnMatchupSide;
  teamsById: Map<number, EspnTeam>;
  lineupSlotCounts: Record<string, number>;
  deadline: WeekDeadline;
}): ObligationInsert[] {
  const { season, week, side, teamsById, lineupSlotCounts, deadline } = args;
  const { teamName, teamLogo } = teamMeta(teamsById, side.teamId);
  const entries = side.rosterForCurrentScoringPeriod?.entries ?? [];
  const starters = entries.filter((entry) => !leagueConfig.benchSlotIds.has(entry.lineupSlotId));
  const obligations: ObligationInsert[] = [];

  for (const entry of starters) {
    const points = getEntryPoints(entry, week);
    const playerName = entry.playerPoolEntry?.player?.fullName ?? `Player ${entry.playerId}`;

    if (points === null) continue;

    if (points < -EPSILON) {
      obligations.push({
        source_key: `${season}:${week}:team:${side.teamId}:player:${entry.playerId}:negative`,
        season,
        week,
        team_id: side.teamId,
        team_name: teamName,
        team_logo: teamLogo,
        type: "NEGATIVE_SCORE",
        description: `${playerName} scored ${points.toFixed(2)} points`,
        player_id: entry.playerId,
        player_name: playerName,
        fantasy_points: points,
        penalty_units: 2,
        due_at: null,
        due_date: deadline.sundayDate
      });
    } else if (Math.abs(points) <= EPSILON) {
      obligations.push({
        source_key: `${season}:${week}:team:${side.teamId}:player:${entry.playerId}:zero`,
        season,
        week,
        team_id: side.teamId,
        team_name: teamName,
        team_logo: teamLogo,
        type: "ZERO_SCORE",
        description: `${playerName} scored 0.00 points`,
        player_id: entry.playerId,
        player_name: playerName,
        fantasy_points: 0,
        penalty_units: 1,
        due_at: null,
        due_date: deadline.sundayDate
      });
    }
  }

  const actualCounts = new Map<number, number>();
  for (const entry of starters) {
    actualCounts.set(entry.lineupSlotId, (actualCounts.get(entry.lineupSlotId) ?? 0) + 1);
  }

  for (const [slotId, expectedCount] of activeStarterSlotCounts(lineupSlotCounts)) {
    const actualCount = actualCounts.get(slotId) ?? 0;
    const missing = Math.max(0, expectedCount - actualCount);

    for (let index = 1; index <= missing; index += 1) {
      const label = slotLabel(slotId);
      obligations.push({
        source_key: `${season}:${week}:team:${side.teamId}:slot:${slotId}:empty:${index}`,
        season,
        week,
        team_id: side.teamId,
        team_name: teamName,
        team_logo: teamLogo,
        type: "EMPTY_SLOT",
        description: `Empty ${label} starting slot`,
        player_id: null,
        player_name: null,
        fantasy_points: null,
        penalty_units: 3,
        due_at: null,
        due_date: deadline.sundayDate
      });
    }
  }

  return obligations;
}

export function generateWeekObligations(args: {
  season: number;
  week: number;
  league: EspnLeagueResponse;
  boxscore: EspnLeagueResponse;
  deadline: WeekDeadline;
}): ObligationInsert[] {
  const { season, week, league, boxscore, deadline } = args;
  const teamsById = new Map((league.teams ?? []).map((team) => [team.id, team]));
  const lineupSlotCounts = league.settings?.rosterSettings?.lineupSlotCounts ?? {};
  const weekMatchups = (boxscore.schedule ?? []).filter((m) => m.matchupPeriodId === week);
  const sides = weekMatchups.flatMap((m) => [m.home, m.away]).filter(Boolean) as EspnMatchupSide[];

  if (!sides.length) return [];

  const minScore = Math.min(...sides.map((side) => side.totalPoints));
  const lowScorers = sides.filter((side) => Math.abs(side.totalPoints - minScore) <= EPSILON);
  const obligations: ObligationInsert[] = [];

  for (const side of lowScorers) {
    const { teamName, teamLogo } = teamMeta(teamsById, side.teamId);
    obligations.push({
      source_key: `${season}:${week}:team:${side.teamId}:recap`,
      season,
      week,
      team_id: side.teamId,
      team_name: teamName,
      team_logo: teamLogo,
      type: "WEEKLY_RECAP",
      description: `Lowest score of Week ${week}: ${side.totalPoints.toFixed(2)} points`,
      player_id: null,
      player_name: null,
      fantasy_points: side.totalPoints,
      penalty_units: 0,
      due_at: deadline.firstKickoff,
      due_date: null
    });
  }

  for (const side of sides) {
    obligations.push(
      ...generateTeamPlayerObligations({
        season,
        week,
        side,
        teamsById,
        lineupSlotCounts,
        deadline
      })
    );
  }

  return obligations;
}
