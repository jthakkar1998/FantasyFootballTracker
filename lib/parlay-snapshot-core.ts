import { localDateParts, zonedLocalToIso } from "./parlay-time";

export type SnapshotSlot = "backup" | "primary";
export interface SnapshotPick {
  id: string;
  season: number;
  week: number;
  team_id: number;
  team_name: string;
  player_name: string;
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
}
export interface SnapshotRecord {
  submission_id: string;
  season: number;
  week: number;
  team_id: number;
  snapshot_slot: SnapshotSlot;
  event_id: string;
  market_id: string;
  sportsbook_player_id: string;
  stat_id: string;
  side_id: string;
  line: string | null;
  odds: string;
  captured_at: string;
  quote_updated_at: string;
}
export interface SnapshotOddsEvent {
  eventID?: string;
  status?: { started?: boolean; cancelled?: boolean; startsAt?: string };
  startTime?: string;
  startsAt?: string;
  odds?: Record<string, {
    oddID?: string;
    statID?: string;
    sideID?: string;
    playerID?: string;
    statEntityID?: string;
    cancelled?: boolean;
    started?: boolean;
    ended?: boolean;
    betTypeID?: string;
    byBookmaker?: Record<string, {
      available?: boolean;
      odds?: string | number;
      overUnder?: string | number;
      lastUpdatedAt?: string;
    } | undefined>;
  }>;
}

/** Cheap time guard before calling ESPN, Supabase, or the sports API. */
export function isPotentialSnapshotInstant(nowIso: string): boolean {
  const date = new Date(nowIso);
  if (!Number.isFinite(date.getTime())) return false;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => formatted.find(part => part.type === type)?.value;
  const minute = Number(value("minute"));
  return value("weekday") === "Sun" && Number(value("hour")) === 11 &&
    ((minute >= 45 && minute < 55) || (minute >= 56 && minute < 60));
}

// These windows are purposely narrow. The cron job runs in UTC; the server
// validates Central local time including DST, even if a scheduler runs late.
export function snapshotSlotForInstant(nowIso: string, sundayDate: string): SnapshotSlot | null {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || localDateParts(nowIso, "America/Chicago").date !== sundayDate) return null;
  const backupStart = Date.parse(zonedLocalToIso(sundayDate, 11, 45, "America/Chicago"));
  const lock = Date.parse(zonedLocalToIso(sundayDate, 11, 55, "America/Chicago"));
  const primaryStart = Date.parse(zonedLocalToIso(sundayDate, 11, 56, "America/Chicago"));
  const noon = Date.parse(zonedLocalToIso(sundayDate, 12, 0, "America/Chicago"));
  if (now >= backupStart && now < lock) return "backup";
  if (now >= primaryStart && now < noon) return "primary";
  return null;
}

export function selectionMatches(record: Pick<SnapshotRecord, "event_id" | "market_id" | "sportsbook_player_id" | "stat_id" | "side_id">, pick: SnapshotPick): boolean {
  return record.event_id === pick.event_id && record.market_id === pick.market_id &&
    record.sportsbook_player_id === pick.sportsbook_player_id &&
    record.stat_id === pick.stat_id && record.side_id === pick.side_id;
}

export function chooseGradingSnapshot(pick: SnapshotPick, snapshots: SnapshotRecord[]): {
  selected: SnapshotRecord | null;
  source: SnapshotSlot | "missing";
} {
  // A pick may be replaced between the backup and primary slots. Never use a
  // backup captured for a previous player or market on the same submission row.
  const valid = snapshots.filter(record => record.submission_id === pick.id && selectionMatches(record, pick));
  const primary = valid.find(record => record.snapshot_slot === "primary");
  if (primary) return { selected: primary, source: "primary" };
  const backup = valid.find(record => record.snapshot_slot === "backup");
  return backup ? { selected: backup, source: "backup" } : { selected: null, source: "missing" };
}

export function parseFanDuelSnapshot(input: {
  pick: SnapshotPick;
  event: SnapshotOddsEvent | undefined;
  slot: SnapshotSlot;
  capturedAt: string;
  maxQuoteAgeMinutes?: number;
}): { record: SnapshotRecord | null; reason: string | null } {
  const { pick, event, slot, capturedAt } = input;
  const time = Date.parse(capturedAt);
  const gameStart = Date.parse(pick.event_starts_at);
  if (!Number.isFinite(time) || !Number.isFinite(gameStart) || time >= gameStart) {
    return { record: null, reason: "Game started or capture time invalid" };
  }
  if (!event || event.eventID !== pick.event_id) return { record: null, reason: "Exact event missing" };
  if (event.status?.started || event.status?.cancelled) return { record: null, reason: "Game started or cancelled" };
  const providerStart = Date.parse(event.status?.startsAt ?? event.startsAt ?? event.startTime ?? "");
  if (Number.isFinite(providerStart) && time >= providerStart) return { record: null, reason: "Provider game start passed" };
  const odd = event.odds?.[pick.market_id];
  if (!odd || (odd.oddID && odd.oddID !== pick.market_id)) {
    return { record: null, reason: "Exact selected market not returned" };
  }
  if (odd.statID !== pick.stat_id || odd.sideID !== pick.side_id ||
    (odd.playerID ?? odd.statEntityID) !== pick.sportsbook_player_id) {
    return { record: null, reason: "Player, stat, or side mismatch" };
  }
  if (odd.cancelled || odd.started || odd.ended) return { record: null, reason: "Market suspended or started" };
  const book = odd.byBookmaker?.fanduel;
  if (!book || book.available !== true || book.odds === null || book.odds === undefined || String(book.odds).trim() === "") {
    return { record: null, reason: "FanDuel quote unavailable" };
  }
  const quoteTime = Date.parse(book.lastUpdatedAt ?? "");
  const maxAgeMs = (input.maxQuoteAgeMinutes ?? 20) * 60_000;
  if (!Number.isFinite(quoteTime) || quoteTime > time + 30_000 || quoteTime >= gameStart || time - quoteTime > maxAgeMs) {
    return { record: null, reason: "FanDuel quote timestamp missing, future-dated, or too old" };
  }
  const isOverUnder = pick.side_id === "over" || pick.side_id === "under";
  if (isOverUnder && odd.betTypeID !== "ou") return { record: null, reason: "Over/Under market type mismatch" };
  if (!isOverUnder && (pick.side_id !== "yes" && pick.side_id !== "no" || odd.betTypeID !== "yn")) {
    return { record: null, reason: "Unsupported selection type" };
  }
  // Never substitute odd.bookOverUnder (consensus) for FanDuel's own line.
  const line = isOverUnder ? String(book.overUnder ?? "") : null;
  if (isOverUnder && (line === "" || !Number.isFinite(Number(line)))) {
    return { record: null, reason: "FanDuel Over/Under line missing or invalid" };
  }
  return { reason: null, record: {
    submission_id: pick.id,
    season: pick.season,
    week: pick.week,
    team_id: pick.team_id,
    snapshot_slot: slot,
    event_id: pick.event_id,
    market_id: pick.market_id,
    sportsbook_player_id: pick.sportsbook_player_id,
    stat_id: pick.stat_id,
    side_id: pick.side_id,
    line,
    odds: String(book.odds),
    captured_at: capturedAt,
    quote_updated_at: new Date(quoteTime).toISOString()
  } };
}
