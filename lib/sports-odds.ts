import { leagueConfig } from "./config";
import { getCachedOdds, setCachedOdds } from "./parlay-db";
import { fetchNflSundayGameForProTeam } from "./nfl";
import type { EligibleParlayPlayer, ParlayPropOption, ParlayPropsResponse } from "./parlay-types";

const API_BASE = "https://api.sportsgameodds.com/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_CACHE_MAX_MS = 6 * 60 * 60 * 1000;
const BOOKMAKER = "fanduel";

interface SportsOddsPlayer {
  playerID?: string;
  teamID?: string;
  position?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  names?: { display?: string; firstName?: string; lastName?: string };
}

interface SportsOddsTeam {
  teamID?: string;
  name?: string;
  names?: { long?: string; medium?: string; short?: string; display?: string };
}

interface SportsOddsBookPrice {
  available?: boolean;
  odds?: string | number;
  overUnder?: string | number;
  lastUpdatedAt?: string;
}

interface SportsOddsOdd {
  oddID?: string;
  marketName?: string;
  statID?: string;
  statEntityID?: string;
  playerID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  started?: boolean;
  ended?: boolean;
  cancelled?: boolean;
  bookOverUnder?: string | number;
  byBookmaker?: Record<string, SportsOddsBookPrice | undefined>;
}

interface SportsOddsEvent {
  eventID?: string;
  startTime?: string;
  startsAt?: string;
  status?: { startsAt?: string; started?: boolean; ended?: boolean; cancelled?: boolean };
  teams?: { home?: SportsOddsTeam; away?: SportsOddsTeam };
  players?: Record<string, SportsOddsPlayer>;
  odds?: Record<string, SportsOddsOdd>;
}

interface SportsOddsResponse<T> {
  success?: boolean;
  data?: T[];
  error?: string;
}

function apiKey(): string {
  const key = process.env.SPORTSGAMEODDS_API_KEY;
  if (!key) throw new Error("Player props are not configured yet. Add SPORTSGAMEODDS_API_KEY to the server environment.");
  return key;
}

export function sportsOddsConfigured(): boolean {
  return Boolean(process.env.SPORTSGAMEODDS_API_KEY);
}

function eventStart(event: SportsOddsEvent): string | null {
  return event.status?.startsAt ?? event.startsAt ?? event.startTime ?? null;
}

function teamName(team: SportsOddsTeam | undefined): string {
  return team?.names?.long ?? team?.names?.display ?? team?.names?.medium ?? team?.name ?? "Unknown";
}

function playerDisplayName(player: SportsOddsPlayer, fallbackId: string): string {
  const composite = [player.names?.firstName ?? player.firstName, player.names?.lastName ?? player.lastName].filter(Boolean).join(" ").trim();
  return player.names?.display ?? player.name ?? (composite || fallbackId);
}

export function normalizePlayerName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function requestApi<T>(path: "events" | "players", params: URLSearchParams, timeoutMs = 10000, label = "SportsGameOdds request"): Promise<T[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}/${path}?${params.toString()}`, {
      headers: { Accept: "application/json", "x-api-key": apiKey() },
      cache: "no-store",
      signal: controller.signal
    });
    const body = (await response.json().catch(() => ({}))) as SportsOddsResponse<T>;
    if (!response.ok || body.success === false) {
      throw new Error(`Odds provider request failed (${response.status}): ${body.error ?? "Unknown error"}`);
    }
    return body.data ?? [];
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function eventMatchesNflGame(event: SportsOddsEvent, homeName: string, awayName: string): boolean {
  const eventTeams = [normalizeTeamName(teamName(event.teams?.home)), normalizeTeamName(teamName(event.teams?.away))].sort();
  const targetTeams = [normalizeTeamName(homeName), normalizeTeamName(awayName)].sort();
  return eventTeams[0] === targetTeams[0] && eventTeams[1] === targetTeams[1];
}

async function fetchLightweightNflSchedule(week: number): Promise<{ events: SportsOddsEvent[]; fetchedAt: string }> {
  const cacheKey = `sgo:nfl:schedule:${leagueConfig.season}:w${week}`;
  const cached = await getCachedOdds<SportsOddsEvent[]>(cacheKey);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
    return { events: cached.payload, fetchedAt: cached.fetchedAt };
  }

  // Request only one ordinary game market so the response stays small. This is
  // used only to resolve SportsGameOdds eventIDs; player props are fetched later
  // from the exact event.
  const params = new URLSearchParams({
    leagueID: "NFL",
    started: "false",
    oddID: "points-home-game-ml-home",
    includeOpposingOdds: "true",
    limit: "25"
  });
  const events = await requestApi<SportsOddsEvent>("events", params, 8000, "SportsGameOdds NFL event lookup");
  const fetchedAt = new Date().toISOString();
  await setCachedOdds(cacheKey, events, fetchedAt);
  return { events, fetchedAt };
}

function findPlayerInEvent(event: SportsOddsEvent, targetName: string): { playerId: string; player: SportsOddsPlayer } | null {
  const target = normalizePlayerName(targetName);
  for (const [key, player] of Object.entries(event.players ?? {})) {
    const playerId = player.playerID ?? key;
    if (normalizePlayerName(playerDisplayName(player, playerId)) === target) return { playerId, player };
  }
  return null;
}

async function resolvePlayerForEvent(event: SportsOddsEvent, targetName: string): Promise<{ playerId: string; player: SportsOddsPlayer }> {
  const embedded = findPlayerInEvent(event, targetName);
  if (embedded) return embedded;

  if (!event.eventID) throw new Error("Could not resolve the sportsbook event for this player.");
  const cacheKey = `sgo:players:${event.eventID}`;
  const cached = await getCachedOdds<SportsOddsPlayer[]>(cacheKey);
  let players: SportsOddsPlayer[];
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < 24 * 60 * 60 * 1000) {
    players = cached.payload;
  } else {
    players = await requestApi<SportsOddsPlayer>("players", new URLSearchParams({ eventID: event.eventID, limit: "100" }), 8000, "SportsGameOdds player lookup");
    await setCachedOdds(cacheKey, players, new Date().toISOString());
  }

  const target = normalizePlayerName(targetName);
  const player = players.find((candidate) => normalizePlayerName(playerDisplayName(candidate, candidate.playerID ?? "")) === target);
  if (!player?.playerID) throw new Error(`SportsGameOdds could not match ${targetName} to this NFL game.`);
  return { playerId: player.playerID, player };
}

async function fetchExactPlayerEvent(eventID: string, playerID: string): Promise<{ event: SportsOddsEvent; fetchedAt: string }> {
  const cacheKey = `sgo:props:${BOOKMAKER}:${eventID}:${playerID}`;
  const cached = await getCachedOdds<SportsOddsEvent>(cacheKey);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
    return { event: cached.payload, fetchedAt: cached.fetchedAt };
  }

  try {
    // eventID is the provider's optimized lookup path. playerID is only shaping
    // the response to this one player's markets, which avoids loading a whole NFL
    // slate or every player prop in the game.
    const events = await requestApi<SportsOddsEvent>("events", new URLSearchParams({ eventID, playerID }), 10000, "SportsGameOdds exact player-prop lookup");
    const event = events[0];
    if (!event) throw new Error("SportsGameOdds returned no event for this player.");
    const fetchedAt = new Date().toISOString();
    await setCachedOdds(cacheKey, event, fetchedAt);
    return { event, fetchedAt };
  } catch (error) {
    // If the provider has a temporary latency spike, allow a recent stale cache
    // rather than breaking a league member's pick screen.
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < STALE_CACHE_MAX_MS) {
      return { event: cached.payload, fetchedAt: cached.fetchedAt };
    }
    throw error;
  }
}

function preferredStats(position: string): string[] {
  switch (position) {
    case "QB":
      return ["passing_yards", "passing_touchdowns", "passing_completions", "rushing_yards"];
    case "RB":
      return ["rushing_yards", "receiving_yards", "receiving_receptions", "touchdowns"];
    case "WR":
    case "TE":
      return ["receiving_yards", "receiving_receptions", "touchdowns", "receiving_longestReception"];
    case "K":
      return ["fieldGoals_made", "kicking_totalPoints", "extraPoints_kicksMade"];
    default:
      return ["receiving_yards", "rushing_yards", "touchdowns", "passing_yards"];
  }
}

function friendlyStat(statId: string): string {
  const names: Record<string, string> = {
    passing_yards: "Passing Yards",
    passing_touchdowns: "Passing Touchdowns",
    passing_completions: "Completions",
    passing_attempts: "Passing Attempts",
    passing_interceptions: "Interceptions",
    rushing_yards: "Rushing Yards",
    rushing_attempts: "Rushing Attempts",
    rushing_touchdowns: "Rushing Touchdowns",
    receiving_yards: "Receiving Yards",
    receiving_receptions: "Receptions",
    receiving_touchdowns: "Receiving Touchdowns",
    receiving_longestReception: "Longest Reception",
    "rushing+receiving_yards": "Rush + Receiving Yards",
    touchdowns: "Touchdowns",
    fieldGoals_made: "Field Goals Made",
    kicking_totalPoints: "Kicking Points",
    extraPoints_kicksMade: "Extra Points Made"
  };
  return names[statId] ?? statId.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyMarket(statId: string, betTypeId: string): string {
  if (statId === "touchdowns") {
    if (betTypeId === "yn") return "Anytime Touchdown";
    if (betTypeId === "ou") return "Total Touchdowns";
  }
  if (statId === "passing_touchdowns") {
    if (betTypeId === "yn") return "1+ Passing Touchdowns";
    if (betTypeId === "ou") return "Passing Touchdowns";
  }
  if (statId === "rushing_touchdowns") {
    if (betTypeId === "yn") return "Rushing Touchdown — Yes/No";
    if (betTypeId === "ou") return "Rushing Touchdowns";
  }
  if (statId === "receiving_touchdowns") {
    if (betTypeId === "yn") return "Receiving Touchdown — Yes/No";
    if (betTypeId === "ou") return "Receiving Touchdowns";
  }
  return friendlyStat(statId);
}

function isFeaturedMarket(position: string, statId: string, betTypeId: string, sideId: string): boolean {
  const preferred = preferredStats(position);
  if (!preferred.includes(statId)) return false;
  if (statId !== "touchdowns") {
    return betTypeId === "ou" && (sideId === "over" || sideId === "under");
  }
  return betTypeId === "yn" && sideId === "yes";
}

function matchupName(event: SportsOddsEvent): string {
  const away = teamName(event.teams?.away);
  const home = teamName(event.teams?.home);
  return `${away} @ ${home}`;
}

function propOptionsForPlayer(event: SportsOddsEvent, playerId: string, playerName: string, position: string, startsAt: string): ParlayPropOption[] {
  const preferred = preferredStats(position);
  const now = Date.now();
  const result: ParlayPropOption[] = [];
  for (const [key, odd] of Object.entries(event.odds ?? {})) {
    const entity = odd.playerID ?? odd.statEntityID;
    if (entity !== playerId) continue;
    if (odd.periodID && odd.periodID !== "game") continue;
    if (odd.cancelled || odd.ended) continue;
    if (new Date(startsAt).getTime() <= now) continue;

    const book = odd.byBookmaker?.[BOOKMAKER];
    if (!book || book.available === false || book.odds === undefined || book.odds === null) continue;
    const statId = odd.statID ?? "player_prop";
    const betTypeId = odd.betTypeID ?? "unknown";
    const sideId = odd.sideID ?? "yes";
    const rawLineValue = book.overUnder ?? odd.bookOverUnder ?? null;
    const lineValue = betTypeId === "ou" ? rawLineValue : null;
    const marketName = friendlyMarket(statId, betTypeId);
    result.push({
      oddId: odd.oddID ?? key,
      playerId,
      playerName,
      position,
      eventId: event.eventID ?? "",
      eventStartsAt: startsAt,
      matchup: matchupName(event),
      statId,
      betTypeId,
      marketName,
      sideId,
      line: lineValue === null ? null : String(lineValue),
      odds: String(book.odds),
      isFeatured: isFeaturedMarket(position, statId, betTypeId, sideId)
    });
  }

  return result.sort((a, b) => {
    const ai = preferred.indexOf(a.statId);
    const bi = preferred.indexOf(b.statId);
    const ar = ai < 0 ? 999 : ai;
    const br = bi < 0 ? 999 : bi;
    return ar - br || a.marketName.localeCompare(b.marketName) || a.sideId.localeCompare(b.sideId);
  });
}

export async function getFanDuelProps(args: {
  player: EligibleParlayPlayer;
  sundayDate: string;
  week: number;
}): Promise<ParlayPropsResponse> {
  if (!args.player.proTeamId) throw new Error(`ESPN did not provide an NFL team for ${args.player.name}.`);

  const nflGame = await fetchNflSundayGameForProTeam({
    week: args.week,
    sundayDate: args.sundayDate,
    proTeamId: args.player.proTeamId
  });

  const { events: schedule } = await fetchLightweightNflSchedule(args.week);
  const scheduleEvent = schedule.find((event) => eventMatchesNflGame(event, nflGame.homeTeamName, nflGame.awayTeamName));
  if (!scheduleEvent?.eventID) {
    throw new Error(`Could not match ${args.player.name}'s Sunday game to SportsGameOdds.`);
  }

  const playerMatch = await resolvePlayerForEvent(scheduleEvent, args.player.name);
  const { event, fetchedAt } = await fetchExactPlayerEvent(scheduleEvent.eventID, playerMatch.playerId);
  const startsAt = eventStart(event) ?? nflGame.startsAt;
  if (new Date(startsAt).getTime() <= Date.now()) {
    throw new Error(`That player's NFL game has already started.`);
  }

  const props = propOptionsForPlayer(event, playerMatch.playerId, args.player.name, playerMatch.player.position ?? args.player.position, startsAt);
  if (!props.length) {
    throw new Error(`No active FanDuel props were found for ${args.player.name} on Sunday's slate.`);
  }

  return {
    player: args.player,
    matchup: matchupName(event),
    eventStartsAt: startsAt,
    fetchedAt,
    props
  };
}
