import { leagueConfig } from "./config";
import { getCurrentParlayContext, getEligiblePlayer, getTeamContext } from "./parlay";
import { fetchNflWeekEvents } from "./nfl";
import { chicagoDate } from "./parlay-live-hit-core";
import { getDb } from "./supabase";
import { updateParlayWeeklyTeamTrackingFields } from "./parlay-tracking-db";

import { validateOffAppInput } from "./parlay-offapp-validation";

export interface OffAppLeg {
  id: string;
  season: number;
  week: number;
  team_id: number;
  team_name: string;
  espn_player_id: number;
  pro_team_id: number;
  player_name: string;
  nfl_event_id: string;
  event_starts_at: string;
  stat_id: string;
  side_id: "over" | "under" | "yes" | "no";
  line: string | null;
  book_name: string;
  confirmed: boolean;
  recorded_at: string;
  notes: string | null;
}

export async function listOffAppLegs(season: number, week?: number): Promise<OffAppLeg[]> {
  let query = getDb().from("parlay_offapp_legs").select("*").eq("season", season);
  if (week !== undefined) query = query.eq("week", week);
  const { data, error } = await query;
  if (error) throw new Error(`Cannot read structured off-app picks: ${error.message}`);
  return (data ?? []) as OffAppLeg[];
}

export interface OffAppInput {
  week: number;
  teamId: number;
  espnPlayerId: number;
  statId: string;
  sideId: "over" | "under" | "yes" | "no";
  line: string | null;
  bookName: string;
  notes?: string;
  confirmed: boolean;
}

export async function saveOffAppLeg(input: OffAppInput): Promise<OffAppLeg> {
  validateOffAppInput(input);
  const context = await getCurrentParlayContext();
  if (context.season !== leagueConfig.season || context.week !== input.week) {
    throw new Error("Structured ticket entry is available for the current fantasy week only. Historical off-app picks remain commissioner-managed.");
  }
  const team = getTeamContext(context, input.teamId);
  const athlete = getEligiblePlayer(context, input.teamId, input.espnPlayerId);
  if (!Number.isInteger(athlete.proTeamId) || Number(athlete.proTeamId) <= 0) {
    throw new Error("Selected player's NFL team cannot be verified.");
  }
  const { data: website, error: websiteError } = await getDb().from("parlay_submissions")
    .select("id").eq("season", context.season).eq("week", context.week)
    .eq("team_id", input.teamId).is("withdrawn_at", null).maybeSingle();
  if (websiteError) throw new Error(`Could not verify pick source: ${websiteError.message}`);
  if (website) throw new Error("A website pick already exists for this team.");
  const events = await fetchNflWeekEvents(context.week);
  const matches = events.filter(event => chicagoDate(event.date) === context.sundayDate &&
    (event.competitions?.[0]?.competitors ?? []).some(c => Number(c.team?.id) === athlete.proTeamId));
  if (matches.length !== 1 || !Number.isFinite(Date.parse(matches[0].date))) {
    throw new Error("Could not uniquely verify the NFL game for this player. Keep the off-app pick in manual review.");
  }
  const now = new Date().toISOString();
  const data = {
    season: context.season, week: context.week, team_id: input.teamId, team_name: team.teamName,
    espn_player_id: athlete.espnPlayerId, pro_team_id: athlete.proTeamId,
    player_name: athlete.name, nfl_event_id: matches[0].id,
    event_starts_at: matches[0].date, stat_id: input.statId,
    side_id: input.sideId, line: input.line, book_name: input.bookName.trim(),
    notes: input.notes?.trim() || null, confirmed: true, recorded_at: now
  };
  // Existing tracking metadata stays the source of truth for whether an off-app
  // leg is part of the ticket; preserving payment fields and manual results.
  const { data: tracking, error: trackingError } = await getDb().from("parlay_weekly_team_tracking")
    .select("outside_result_status").eq("season", context.season).eq("week", context.week)
    .eq("team_id", input.teamId).maybeSingle();
  if (trackingError) throw new Error(`Could not verify previous off-app result: ${trackingError.message}`);
  const { data: previous, error: previousError } = await getDb().from("parlay_offapp_legs")
    .select("espn_player_id,stat_id,side_id,line,event_starts_at")
    .eq("season", context.season).eq("week", context.week).eq("team_id", input.teamId).maybeSingle();
  if (previousError) throw new Error(`Could not verify previous ticket leg: ${previousError.message}`);
  // The initial structured entry must not erase an already-confirmed manual
  // Miss; only changing an EXISTING structured wager invalidates its old result.
  const changedLeg = Boolean(previous) && (previous!.espn_player_id !== athlete.espnPlayerId ||
    previous!.stat_id !== input.statId || previous!.side_id !== input.sideId ||
    previous!.line !== input.line || Date.parse(previous!.event_starts_at) !== Date.parse(matches[0].date));
  await updateParlayWeeklyTeamTrackingFields({
    season: context.season, week: context.week, teamId: input.teamId, outside: true,
    details: `${athlete.name} ${input.sideId.toUpperCase()} ${input.line ?? ""} ${input.statId} (${input.bookName})`.slice(0, 400),
    ...((tracking?.outside_result_status === "no_bet" ||
      changedLeg && tracking?.outside_result_status && tracking.outside_result_status !== "pending")
      ? { result: "pending" as const } : {})
  });
  const { data: stored, error } = await getDb().from("parlay_offapp_legs")
    .upsert(data, { onConflict: "season,week,team_id" }).select("*").single();
  if (error) throw new Error(`Could not save off-app ticket leg: ${error.message}`);
  return stored as OffAppLeg;
}
