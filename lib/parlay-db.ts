import { getDb } from "./supabase";
import type { ParlaySubmission, ParlayWeekContext } from "./parlay-types";

export interface ParlaySubmissionInput {
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
  submitted_by_name: string;
  payment_confirmed_at: string;
}

export async function listParlaySubmissions(season: number, week: number): Promise<ParlaySubmission[]> {
  const { data, error } = await getDb()
    .from("parlay_submissions")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .is("withdrawn_at", null)
    .order("team_name", { ascending: true });
  if (error) throw new Error(`Could not load parlay picks: ${error.message}`);
  return (data ?? []) as ParlaySubmission[];
}

export async function upsertParlaySubmission(input: ParlaySubmissionInput): Promise<ParlaySubmission> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await getDb().from("parlay_submissions")
    .select("submitted_at,payment_confirmed_at,payment_verified_at")
    .eq("season", input.season).eq("week", input.week).eq("team_id", input.team_id).maybeSingle();
  if (existingError) throw new Error(`Could not check existing payment status: ${existingError.message}`);
  const payload = {
    ...input,
    withdrawn_at: null,
    result_status: "pending",
    graded_at: null,
    payment_confirmed_at: existing?.payment_confirmed_at ?? input.payment_confirmed_at,
    payment_verified_at: existing?.payment_verified_at ?? null,
    eligibility_at_lock: null,
    eligibility_reason: null,
    submitted_at: existing?.submitted_at ?? now,
    updated_at: now
  };
  const { data, error } = await getDb()
    .from("parlay_submissions")
    .upsert(payload, { onConflict: "season,week,team_id" })
    .select("*")
    .single();
  if (error) throw new Error(`Could not save parlay pick: ${error.message}`);
  return data as ParlaySubmission;
}

export async function withdrawParlaySubmission(season: number, week: number, teamId: number): Promise<void> {
  const { error } = await getDb()
    .from("parlay_submissions")
    .update({ withdrawn_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("season", season)
    .eq("week", week)
    .eq("team_id", teamId);
  if (error) throw new Error(`Could not withdraw parlay pick: ${error.message}`);
}

export async function getCachedOdds<T>(cacheKey: string): Promise<{ payload: T; fetchedAt: string } | null> {
  const { data, error } = await getDb()
    .from("parlay_odds_cache")
    .select("payload, fetched_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error) throw new Error(`Could not read odds cache: ${error.message}`);
  if (!data) return null;
  return { payload: data.payload as T, fetchedAt: String(data.fetched_at) };
}

export async function setCachedOdds(cacheKey: string, payload: unknown, fetchedAt: string): Promise<void> {
  const { error } = await getDb().from("parlay_odds_cache").upsert({
    cache_key: cacheKey,
    payload,
    fetched_at: fetchedAt
  });
  if (error) throw new Error(`Could not save odds cache: ${error.message}`);
}

export async function getParlayWeekLock(season: number, week: number): Promise<{lockedAt: string; deadlineAt: string} | null> {
  const { data, error } = await getDb()
    .from("parlay_week_locks")
    .select("locked_at,deadline_at")
    .eq("season", season)
    .eq("week", week)
    .maybeSingle();
  if (error) throw new Error(`Could not read parlay lock: ${error.message}`);
  return data?.locked_at ? { lockedAt: String(data.locked_at), deadlineAt: String(data.deadline_at) } : null;
}

export async function ensureParlayWeekLocked(context: ParlayWeekContext): Promise<boolean> {
  const deadlineMs = new Date(context.deadlineAt).getTime();
  if (Date.now() < deadlineMs) return false;
  const previousLock = await getParlayWeekLock(context.season, context.week);
  // If the commissioner changes the deadline, re-snapshot using the new cutoff
  // instead of accepting a lock made at the old time.
  if (previousLock?.deadlineAt === context.deadlineAt) return true;

  const submissions = await listParlaySubmissions(context.season, context.week);
  const db = getDb();
  for (const submission of submissions) {
    const team = context.teams.find((item) => item.teamId === submission.team_id);
    const isStarter = Boolean(team?.eligiblePlayers.some((player) => player.espnPlayerId === submission.espn_player_id));
    const gameNotStartedAtLock = new Date(submission.event_starts_at).getTime() >= deadlineMs;
    const eligible = isStarter && gameNotStartedAtLock;
    const reason = eligible
      ? null
      : !isStarter
        ? "Player was not in the opponent's starting lineup at the lock snapshot."
        : "Player's NFL game had already started before the parlay deadline.";
    const { error } = await db
      .from("parlay_submissions")
      .update({ eligibility_at_lock: eligible, eligibility_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", submission.id);
    if (error) throw new Error(`Could not lock parlay eligibility: ${error.message}`);
  }

  const lockedAt = new Date().toISOString();
  const { error: lockError } = await db.from("parlay_week_locks").upsert({
    season: context.season,
    week: context.week,
    deadline_at: context.deadlineAt,
    locked_at: lockedAt
  }, { onConflict: "season,week" });
  if (lockError) throw new Error(`Could not save parlay lock: ${lockError.message}`);
  return true;
}

export async function listParlayHistory(season?: number): Promise<ParlaySubmission[]> {
  let query = getDb().from("parlay_submissions").select("*");
  if (season !== undefined) query = query.eq("season", season);
  const { data, error } = await query.order("season", { ascending: false })
    .order("week", { ascending: false }).order("team_name", { ascending: true }).limit(500);
  if (error) throw new Error(`Could not load parlay history: ${error.message}`);
  return (data ?? []) as ParlaySubmission[];
}

export async function updateParlayAdminStatus(args: {
  id: string;
  kind: "result" | "payment";
  value: string;
}): Promise<void> {
  if (!/^[a-f0-9-]{36}$/i.test(args.id)) throw new Error("Invalid pick identifier.");
  let patch: Record<string, string | null>;
  if (args.kind === "result") {
    if (!["pending", "hit", "miss", "push", "void"].includes(args.value)) throw new Error("Invalid result.");
    patch = { result_status: args.value, graded_at: args.value === "pending" ? null : new Date().toISOString() };
  } else if (args.kind === "payment") {
    if (!["verified", "unverified"].includes(args.value)) throw new Error("Invalid payment action.");
    patch = { payment_verified_at: args.value === "verified" ? new Date().toISOString() : null };
  } else throw new Error("Invalid update type.");
  const { error } = await getDb().from("parlay_submissions").update(patch).eq("id", args.id);
  if (error) throw new Error(`Could not update pick: ${error.message}`);
}
