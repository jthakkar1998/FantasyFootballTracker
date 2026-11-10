import { matchesEspnProTeam } from "./nfl-team-names";
import { localDateParts } from "./parlay-time";

export interface NflOddsGame {
  eventID?: string;
  startTime?: string;
  startsAt?: string;
  status?: { startsAt?: string; started?: boolean; ended?: boolean; cancelled?: boolean };
  teams?: {
    home?: { teamID?: string; name?: string; names?: { long?: string; medium?: string; short?: string; display?: string } };
    away?: { teamID?: string; name?: string; names?: { long?: string; medium?: string; short?: string; display?: string } };
  };
}

export function nflOddsGameStart(game: NflOddsGame): string | null {
  return game.status?.startsAt ?? game.startsAt ?? game.startTime ?? null;
}

/** No ESPN NFL call: the fantasy roster already supplies the verified proTeamId.
 * Fail closed unless exactly ONE real SportsGameOdds game has this club on the
 * required Chicago Sunday (not an international Monday or duplicate event). */
export function findUniqueSundayOddsGame<T extends NflOddsGame>(
  games: T[], proTeamId: number, sundayDate: string
): T | null {
  const matching = games.filter(game => {
    const start = nflOddsGameStart(game);
    if (!game.eventID || !start || !Number.isFinite(Date.parse(start))) return false;
    if (localDateParts(start, "America/Chicago").date !== sundayDate) return false;
    if (game.status?.cancelled || game.status?.ended || game.status?.started) return false;
    const { home, away } = game.teams ?? {};
    // One side must be the player's team and the opposing side must be known.
    return Boolean(home && away &&
      Number(matchesEspnProTeam(proTeamId, home)) + Number(matchesEspnProTeam(proTeamId, away)) === 1);
  });
  return matching.length === 1 ? matching[0] : null;
}

/** Avoid using an exact-name player who belongs to the other NFL team. */
export function oddsPlayerTeamVerified(
  game: NflOddsGame, proTeamId: number, sportsbookPlayerTeamId: string | undefined
): boolean {
  if (!sportsbookPlayerTeamId) return true; // Older provider entries may omit teamID.
  const { home, away } = game.teams ?? {};
  const matchingSide = [home, away].find(side => matchesEspnProTeam(proTeamId, side));
  return !matchingSide?.teamID || matchingSide.teamID === sportsbookPlayerTeamId;
}
