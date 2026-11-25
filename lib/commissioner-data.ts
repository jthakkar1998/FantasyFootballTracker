/** Shared READ-ONLY data for the five commissioner views. No writes or cron calls. */
import { leagueConfig } from "./config";
import { fetchLeagueSummary, teamDisplayName } from "./espn";
import { listParlayHistory } from "./parlay-db";
import { listParlayWeeklyTeamTracking } from "./parlay-tracking-db";
import { listOffAppLegs } from "./parlay-offapp";
import { makeParlayCommissionerRows } from "./parlay-admin";
import { getCurrentParlayContext } from "./parlay";
import { databaseConfigured, listObligations } from "./supabase";

export async function loadCommissionerData(options: { eligiblePlayers?: boolean; offApp?: boolean } = {}) {
  const configured = databaseConfigured();
  const [obligations, history, tracking] = configured ? await Promise.all([
    listObligations(), listParlayHistory(), listParlayWeeklyTeamTracking(leagueConfig.season)
  ]) : [[], [], []] as const;
  let roster: { teamId: number; teamName: string }[] = [];
  let currentWeek = 1;
  let rosterUnavailable = false;
  try {
    const summary = await fetchLeagueSummary();
    roster = (summary.teams ?? []).map(team => ({ teamId: team.id, teamName: teamDisplayName(team, team.id) }));
    const reported = Number(summary.status?.currentMatchupPeriod ?? summary.scoringPeriodId ?? summary.status?.latestScoringPeriod ?? 1);
    if (Number.isFinite(reported)) currentWeek = Math.max(1, Math.floor(reported));
    if (!roster.length) rosterUnavailable = true;
  } catch { rosterUnavailable = true; }
  let thisWeek: { week: number; teams: Awaited<ReturnType<typeof getCurrentParlayContext>>["teams"] } | null = null;
  if (options.eligiblePlayers && configured) {
    try {
      const context = await getCurrentParlayContext();
      thisWeek = { week: context.week, teams: context.teams };
      currentWeek = Math.max(currentWeek, context.week);
      if (!roster.length) roster = context.teams.map(team => ({ teamId: team.teamId, teamName: team.teamName }));
    } catch { /* Existing commissioner history must work through ESPN/odds outages. */ }
  }
  if (!roster.length) roster = [...new Map(obligations.filter(item => item.season === leagueConfig.season)
    .map(item => [item.team_id, { teamId: item.team_id, teamName: item.team_name }] as const)).values()];
  const rows = makeParlayCommissionerRows({ season: leagueConfig.season, throughWeek: currentWeek,
    teams: roster, submissions: [...history], tracking: [...tracking] });
  let offapp: Awaited<ReturnType<typeof listOffAppLegs>> = [];
  let offappUnavailable = false;
  if (configured && options.offApp) {
    try { offapp = await listOffAppLegs(leagueConfig.season); }
    catch { offappUnavailable = true; }
  }
  return { configured, obligations, history, tracking, roster, rosterUnavailable,
    currentWeek, thisWeek, rows, offapp, offappUnavailable };
}
