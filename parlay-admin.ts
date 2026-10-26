import type { ParlaySubmission } from "./parlay-types";

export interface CommissionerTeam {
  teamId: number;
  teamName: string;
}

export interface ParlayWeeklyTeamTracking {
  season: number;
  week: number;
  team_id: number;
  submitted_outside_app: boolean;
  outside_bet_details: string | null;
  outside_result_status: "pending" | "hit" | "miss" | "push" | "void";
  outside_graded_at: string | null;
  payment_verified_at: string | null;
  updated_at: string;
}

export interface ParlayCommissionerRow {
  season: number;
  week: number;
  teamId: number;
  teamName: string;
  pick: ParlaySubmission | null;
  tracking: ParlayWeeklyTeamTracking | null;
  hasWebsitePick: boolean;
  hasOutsidePick: boolean;
  paymentVerifiedAt: string | null;
}

export function makeParlayCommissionerRows(args: {
  season: number;
  throughWeek: number;
  teams: CommissionerTeam[];
  submissions: ParlaySubmission[];
  tracking: ParlayWeeklyTeamTracking[];
}): ParlayCommissionerRow[] {
  const { season, submissions, tracking } = args;
  // Use ESPN's entire league roster, including teams on bye weeks, and retain
  // teams known only from previous submissions or commissioner tracking.
  const teams = new Map<number, string>(args.teams.map(team => [team.teamId, team.teamName]));
  for (const pick of submissions) {
    if (pick.season === season && !teams.has(pick.team_id)) teams.set(pick.team_id, pick.team_name);
  }
  for (const record of tracking) {
    if (record.season === season && !teams.has(record.team_id)) teams.set(record.team_id, `Team ${record.team_id}`);
  }
  const picks = new Map(submissions.filter(p => p.season === season).map(p => [`${p.week}:${p.team_id}`, p]));
  const tracked = new Map(tracking.filter(t => t.season === season).map(t => [`${t.week}:${t.team_id}`, t]));
  const throughWeek = Math.min(22, Math.max(
    1,
    args.throughWeek,
    ...submissions.filter(p => p.season === season).map(p => p.week),
    ...tracking.filter(t => t.season === season).map(t => t.week)
  ));
  const sortedTeams = [...teams.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows: ParlayCommissionerRow[] = [];
  for (let week = throughWeek; week >= 1; week--) {
    for (const [teamId, teamName] of sortedTeams) {
      const pick = picks.get(`${week}:${teamId}`) ?? null;
      const record = tracked.get(`${week}:${teamId}`) ?? null;
      const hasWebsitePick = Boolean(pick && !pick.withdrawn_at);
      rows.push({
        season, week, teamId, teamName,
        pick, tracking: record, hasWebsitePick,
        hasOutsidePick: !hasWebsitePick && Boolean(record?.submitted_outside_app),
        paymentVerifiedAt: record ? record.payment_verified_at : (pick?.payment_verified_at ?? null)
      });
    }
  }
  return rows;
}
