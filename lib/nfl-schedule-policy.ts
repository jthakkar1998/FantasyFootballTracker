import type { NflEvent } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Only complete, uniquely identified games can become a grading lookup. */
export function validNflEvents(value: unknown): value is NflEvent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return false;
  const ids = new Set<string>();
  for (const event of value as NflEvent[]) {
    if (!event || typeof event.id !== "string" || !event.id ||
        typeof event.date !== "string" || !Number.isFinite(Date.parse(event.date))) return false;
    const teams = event.competitions?.[0]?.competitors;
    if (!Array.isArray(teams) || teams.length !== 2) return false;
    const teamIds = teams.map(team => Number(team?.team?.id)).filter(id => Number.isInteger(id) && id > 0);
    if (ids.has(event.id) || new Set(teamIds).size !== 2) return false;
    ids.add(event.id);
  }
  return true;
}

/** Long-lived for final historical matchups, short-lived near live kickoff. */
export function nflScheduleCachePolicy(weekSundayDate: string | null, nowMs: number): {
  freshMs: number; staleOnErrorMs: number;
} {
  if (!weekSundayDate) return { freshMs: 60 * 60_000, staleOnErrorMs: 2 * DAY };
  const sunday = Date.parse(`${weekSundayDate}T12:00:00Z`);
  if (!Number.isFinite(sunday)) return { freshMs: HOUR, staleOnErrorMs: 2 * DAY };
  if (nowMs >= sunday + 3 * DAY) return { freshMs: 30 * DAY, staleOnErrorMs: 45 * DAY };
  if (nowMs >= sunday - 2 * DAY) return { freshMs: HOUR, staleOnErrorMs: 2 * DAY };
  return { freshMs: 12 * HOUR, staleOnErrorMs: 7 * DAY };
}

/** Core cache policy is testable without Supabase, Vercel or ESPN network calls. */
export async function loadCachedNflSchedule(args: {
  cached: { payload: unknown; fetchedAt: string } | null;
  fetchFresh: () => Promise<unknown>;
  saveFresh: (events: NflEvent[], fetchedAt: string) => Promise<void>;
  nowMs: number;
  policy: { freshMs: number; staleOnErrorMs: number };
  onWarning?: (message: string) => void;
}): Promise<NflEvent[]> {
  const { cached, nowMs, policy, onWarning } = args;
  const ageMs = cached ? nowMs - Date.parse(cached.fetchedAt) : Infinity;
  const validCache = cached && Number.isFinite(ageMs) && ageMs >= 0 && validNflEvents(cached.payload);
  if (validCache && ageMs <= policy.freshMs) return cached.payload as NflEvent[];
  try {
    const fresh = await args.fetchFresh();
    if (!validNflEvents(fresh)) throw new Error("NFL schedule data was empty or lacked verified game/team identifiers");
    try { await args.saveFresh(fresh, new Date(nowMs).toISOString()); }
    catch (error) { onWarning?.(`NFL schedule cache write failed: ${error instanceof Error ? error.message : String(error)}`); }
    return fresh;
  } catch (error) {
    if (validCache && ageMs <= policy.staleOnErrorMs) {
      onWarning?.(`Using validated cached NFL schedule (${Math.round(ageMs / 60000)} min old) after upstream failure: ${error instanceof Error ? error.message : String(error)}`);
      return cached.payload as NflEvent[];
    }
    onWarning?.(`Upstream NFL schedule unavailable and no sufficiently recent validated cache: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
