import { leagueConfig } from "./config";
import { getCachedOdds, setCachedOdds } from "./parlay-db";
import { isOnLocalDate } from "./parlay-time";
import type { EligibleParlayPlayer, ParlayPropOption, ParlayPropsResponse } from "./parlay-types";

const API_BASE = "https://api.sportsgameodds.com/v2";
const CACHE_TTL_MS = 10 * 60 * 1000;
const BOOKMAKER = "fanduel";

interface SportsOddsPlayer {
  playerID?: string;
  position?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  names?: { display?: string; firstName?: string; lastName?: string };
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
  teams?: {
    home?: { name?: string; names?: { long?: string; display?: string } };
    away?: { name?: string; names?: { long?: string; display?: string } };
  };
  players?: Record<string, SportsOddsPlayer>;
  odds?: Record<string, SportsOddsOdd>;
}

interface SportsOddsResponse {
  success?: boolean;
  data?: SportsOddsEvent[];
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

function teamName(team: { name?: string; names?: { long?: string; display?: string } } | undefined): string {
  return team?.names?.long ?? team?.names?.display ?? team?.name ?? "Unknown";
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

async function fetchSundaySlate(sundayDate: string, week: number): Promise<{ events: SportsOddsEvent[]; fetchedAt: string }> {
  const cacheKey = `sgo:nfl:${BOOKMAKER}:${leagueConfig.season}:w${week}:${sundayDate}`;
  const cached = await getCachedOdds<SportsOddsEvent[]>(cacheKey);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
    return { events: cached.payload, fetchedAt: cached.fetchedAt };
  }

  const params = new URLSearchParams({
    leagueID: "NFL",
    bookmakerID: BOOKMAKER,
    oddsAvailable: "true",
    limit: "100"
  });
  const response = await fetch(`${API_BASE}/events?${params.toString()}`, {
    headers: { Accept: "application/json", "x-api-key": apiKey() },
    cache: "no-store"
  });
  const body = (await response.json().catch(() => ({}))) as SportsOddsResponse;
  if (!response.ok || body.success === false) {
    throw new Error(`Odds provider request failed (${response.status}): ${body.error ?? "Unknown error"}`);
  }

  const events = (body.data ?? []).filter((event) => {
    const startsAt = eventStart(event);
    return Boolean(startsAt && isOnLocalDate(startsAt, sundayDate));
  });
  const fetchedAt = new Date().toISOString();
  await setCachedOdds(cacheKey, events, fetchedAt);
  return { events, fetchedAt };
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
    touchdowns: "Anytime Touchdown",
    fieldGoals_made: "Field Goals Made",
    kicking_totalPoints: "Kicking Points",
    extraPoints_kicksMade: "Extra Points Made"
  };
  return names[statId] ?? statId.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function matchupName(event: SportsOddsEvent): string {
  const away = teamName(event.teams?.away);
  const home = teamName(event.teams?.home);
  return `${away} @ ${home}`;
}

function findPlayerInEvent(event: SportsOddsEvent, targetName: string): { playerId: string; player: SportsOddsPlayer } | null {
  const target = normalizePlayerName(targetName);
  for (const [key, player] of Object.entries(event.players ?? {})) {
    const playerId = player.playerID ?? key;
    if (normalizePlayerName(playerDisplayName(player, playerId)) === target) return { playerId, player };
  }
  return null;
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
    const sideId = odd.sideID ?? "yes";
    const lineValue = book.overUnder ?? odd.bookOverUnder ?? null;
    const marketName = friendlyStat(statId);
    const featuredRank = preferred.indexOf(statId);
    result.push({
      oddId: odd.oddID ?? key,
      playerId,
      playerName,
      position,
      eventId: event.eventID ?? "",
      eventStartsAt: startsAt,
      matchup: matchupName(event),
      statId,
      marketName,
      sideId,
      line: lineValue === null ? null : String(lineValue),
      odds: String(book.odds),
      isFeatured: featuredRank >= 0 && (statId !== "touchdowns" || sideId === "yes")
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
  const { events, fetchedAt } = await fetchSundaySlate(args.sundayDate, args.week);
  for (const event of events) {
    const startsAt = eventStart(event);
    if (!startsAt || new Date(startsAt).getTime() <= Date.now()) continue;
    const match = findPlayerInEvent(event, args.player.name);
    if (!match) continue;
    const props = propOptionsForPlayer(event, match.playerId, args.player.name, match.player.position ?? args.player.position, startsAt);
    if (!props.length) continue;
    return {
      player: args.player,
      matchup: matchupName(event),
      eventStartsAt: startsAt,
      fetchedAt,
      props
    };
  }
  throw new Error(`No active FanDuel props were found for ${args.player.name} on Sunday's slate.`);
}
