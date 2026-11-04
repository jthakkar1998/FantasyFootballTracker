import { getDb } from "./supabase";
import type { SnapshotPick, SnapshotRecord, SnapshotSlot } from "./parlay-snapshot-core";

export interface SnapshotRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  slot: SnapshotSlot;
  status: "success" | "partial" | "error";
  season: number;
  week: number;
  attempted: number;
  captured: number;
  failures: { team: string; reason: string }[];
  error_message: string | null;
  usage_warning: string | null;
}

export async function listSnapshotPicks(season: number, week: number): Promise<SnapshotPick[]> {
  const { data, error } = await getDb().from("parlay_submissions")
    .select("id,season,week,team_id,team_name,player_name,sportsbook_player_id,event_id,event_starts_at,market_id,market_name,stat_id,side_id,line,odds,bookmaker")
    .eq("season", season).eq("week", week).is("withdrawn_at", null);
  if (error) throw new Error(`Could not read snapshot picks: ${error.message}`);
  return (data ?? []) as SnapshotPick[];
}

export async function listSnapshots(season: number, week?: number): Promise<SnapshotRecord[]> {
  let query = getDb().from("parlay_line_snapshots").select("*").eq("season", season);
  if (week !== undefined) query = query.eq("week", week);
  const { data, error } = await query.order("captured_at", { ascending: true }).limit(500);
  if (error) throw new Error(`Could not read FanDuel snapshots: ${error.message}`);
  return (data ?? []) as SnapshotRecord[];
}

export async function listSnapshotRuns(season: number, limit = 30): Promise<SnapshotRun[]> {
  const { data, error } = await getDb().from("parlay_snapshot_runs").select("*")
    .eq("season", season).order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not read snapshot diagnostics: ${error.message}`);
  return (data ?? []) as SnapshotRun[];
}

export async function storeSnapshotRows(rows: SnapshotRecord[]): Promise<void> {
  if (!rows.length) return;
  // The first valid quote for a particular pick and slot wins, even if
  // a retry or concurrent scheduled run observes a newer line.
  const { error } = await getDb().from("parlay_line_snapshots").upsert(rows, {
    onConflict: "submission_id,snapshot_slot,event_id,market_id,sportsbook_player_id,stat_id,side_id",
    ignoreDuplicates: true
  });
  if (error) throw new Error(`Could not save FanDuel snapshots: ${error.message}`);
}

export async function saveSnapshotRun(run: Omit<SnapshotRun, "id" | "started_at" | "finished_at"> & { started_at: string; finished_at: string }): Promise<void> {
  const { error } = await getDb().from("parlay_snapshot_runs").insert(run);
  if (error) throw new Error(`Could not log snapshot attempt: ${error.message}`);
}
