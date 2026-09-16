export type ObligationType =
  | "WEEKLY_RECAP"
  | "ZERO_SCORE"
  | "NEGATIVE_SCORE"
  | "EMPTY_SLOT";

export interface ObligationInsert {
  source_key: string;
  season: number;
  week: number;
  team_id: number;
  team_name: string;
  team_logo: string | null;
  type: ObligationType;
  description: string;
  player_id: number | null;
  player_name: string | null;
  fantasy_points: number | null;
  penalty_units: number;
  due_at: string | null;
  due_date: string | null;
}

export interface Obligation extends ObligationInsert {
  id: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  logo?: string;
}

export interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: {
    appliedStatTotal?: number;
    player?: {
      fullName?: string;
      stats?: Array<{
        scoringPeriodId?: number;
        statSourceId?: number;
        statSplitTypeId?: number;
        appliedTotal?: number;
      }>;
    };
  };
}

export interface EspnMatchupSide {
  teamId: number;
  totalPoints: number;
  rosterForCurrentScoringPeriod?: {
    entries?: EspnRosterEntry[];
  };
}

export interface EspnMatchup {
  id: number;
  matchupPeriodId: number;
  winner?: "HOME" | "AWAY" | "UNDECIDED" | string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

export interface EspnLeagueResponse {
  id: number;
  seasonId: number;
  scoringPeriodId?: number;
  settings?: {
    name?: string;
    size?: number;
    rosterSettings?: {
      lineupSlotCounts?: Record<string, number>;
    };
    scheduleSettings?: {
      matchupPeriodCount?: number;
    };
  };
  status?: {
    currentMatchupPeriod?: number;
    latestScoringPeriod?: number;
    finalScoringPeriod?: number;
    isActive?: boolean;
    isViewable?: boolean;
  };
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
}

export interface NflEvent {
  id: string;
  date: string;
  name?: string;
}

export interface NflScoreboardResponse {
  events?: NflEvent[];
}

export interface WeekDeadline {
  firstKickoff: string;
  sundayDate: string;
}
