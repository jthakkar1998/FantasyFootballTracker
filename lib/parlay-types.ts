export interface EligibleParlayPlayer {
  espnPlayerId: number;
  name: string;
  position: string;
  lineupSlotId: number;
  proTeamId: number | null;
}

export interface ParlayTeamContext {
  teamId: number;
  teamName: string;
  teamLogo: string | null;
  opponentTeamId: number;
  opponentTeamName: string;
  eligiblePlayers: EligibleParlayPlayer[];
}

export interface ParlayWeekContext {
  season: number;
  week: number;
  sundayDate: string;
  deadlineAt: string;
  locked: boolean;
  teams: ParlayTeamContext[];
}

export interface ParlaySubmission {
  id: string;
  season: number;
  week: number;
  team_id: number;
  team_name: string;
  opponent_team_id: number;
  opponent_team_name: string;
  espn_player_id: number;
  player_name: string;
  player_position: string | null;
  sportsbook_player_id: string;
  event_id: string;
  event_starts_at: string;
  market_id: string;
  market_name: string;
  stat_id: string;
  side_id: string;
  line: string | null;
  odds: string;
  bookmaker: string;
  eligibility_at_lock: boolean | null;
  eligibility_reason: string | null;
  submitted_at: string;
  updated_at: string;
}

export interface ParlayPropOption {
  oddId: string;
  playerId: string;
  playerName: string;
  position: string | null;
  eventId: string;
  eventStartsAt: string;
  matchup: string;
  statId: string;
  betTypeId: string;
  marketName: string;
  sideId: string;
  line: string | null;
  odds: string;
  isFeatured: boolean;
}

export interface ParlayPropsResponse {
  player: EligibleParlayPlayer;
  matchup: string;
  eventStartsAt: string;
  fetchedAt: string;
  props: ParlayPropOption[];
}
