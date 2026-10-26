import { getDb } from "./supabase";
import type { ParlayWeeklyTeamTracking } from "./parlay-admin";

type TrackingAction = "outside" | "payment" | "outside_result" | "outside_details";

export async function listParlayWeeklyTeamTracking(season: number): Promise<ParlayWeeklyTeamTracking[]> {
  const { data, error } = await getDb().from("parlay_weekly_team_tracking")
    .select("*").eq("season", season).order("week", { ascending: false });
  if (error) throw new Error(`Could not load weekly commissioner records: ${error.message}`);
  return (data ?? []) as ParlayWeeklyTeamTracking[];
}

export async function updateParlayWeeklyTeamTracking(args: {
  season: number;
  week: number;
  teamId: number;
  action: TrackingAction;
  value: string;
}): Promise<void> {
  const { season, week, teamId, action, value } = args;
  if (!Number.isInteger(season) || season < 2000 || season > 2100 ||
      !Number.isInteger(week) || week < 1 || week > 22 ||
      !Number.isInteger(teamId) || teamId < 1) {
    throw new Error("Invalid season, week, or team.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const patch: Record<string, string | boolean | null> = { updated_at: now };

  if (action === "outside") {
    if (!['yes', 'no'].includes(value)) throw new Error("Invalid off-app pick action.");
    if (value === "yes") {
      // A website submission always takes precedence over an outside-app pick.
      const { data, error } = await db.from("parlay_submissions").select("id")
        .eq("season", season).eq("week", week).eq("team_id", teamId)
        .is("withdrawn_at", null).maybeSingle();
      if (error) throw new Error(`Could not verify website submission: ${error.message}`);
      if (data) throw new Error("This team already has an active website pick.");
    }
    patch.submitted_outside_app = value === "yes";
  } else if (action === "payment") {
    if (!['verified', 'unverified'].includes(value)) throw new Error("Invalid payment update.");
    patch.payment_verified_at = value === "verified" ? now : null;
  } else if (action === "outside_result") {
    if (!["pending", "hit", "miss", "push", "void"].includes(value)) throw new Error("Invalid outcome.");
    patch.outside_result_status = value;
    patch.outside_graded_at = value === "pending" ? null : now;
  } else if (action === "outside_details") {
    if (value.length > 400) throw new Error("Off-app bet description must be 400 characters or fewer.");
    patch.outside_bet_details = value.trim() || null;
  } else {
    throw new Error("Invalid update type.");
  }

  // Insert only if absent, then update only the edited field. This avoids
  // accidentally resetting an existing payment when changing the off-app flag.
  const { error: seedError } = await db.from("parlay_weekly_team_tracking")
    .upsert({ season, week, team_id: teamId }, { onConflict: "season,week,team_id", ignoreDuplicates: true });
  if (seedError) throw new Error(`Could not create weekly tracking record: ${seedError.message}`);
  const { error } = await db.from("parlay_weekly_team_tracking").update(patch)
    .eq("season", season).eq("week", week).eq("team_id", teamId);
  if (error) throw new Error(`Could not update weekly tracking record: ${error.message}`);
}
