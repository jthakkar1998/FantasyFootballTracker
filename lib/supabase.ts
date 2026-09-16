import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Obligation, ObligationInsert } from "./types";

let client: SupabaseClient | null = null;

export function databaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

export async function reconcileWeekObligations(
  season: number,
  week: number,
  rows: ObligationInsert[]
): Promise<number> {
  const db = getDb();

  const { data: existing, error: existingError } = await db
    .from("obligations")
    .select("id, source_key")
    .eq("season", season)
    .eq("week", week);
  if (existingError) throw new Error(`Supabase reconciliation query failed: ${existingError.message}`);

  if (rows.length) {
    // Only columns in the payload are updated on conflict, so commissioner-managed
    // completed/completed_at values remain intact while ESPN-derived facts can refresh.
    const { error: upsertError } = await db.from("obligations").upsert(rows, {
      onConflict: "source_key"
    });
    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  const liveKeys = new Set(rows.map((row) => row.source_key));
  const staleIds = (existing ?? [])
    .filter((row) => !liveKeys.has(String(row.source_key)))
    .map((row) => String(row.id));

  if (staleIds.length) {
    const { error: deleteError } = await db.from("obligations").delete().in("id", staleIds);
    if (deleteError) throw new Error(`Supabase reconciliation delete failed: ${deleteError.message}`);
  }

  return rows.length;
}

export async function listImportedWeeks(season: number): Promise<number[]> {
  const db = getDb();
  const { data, error } = await db.from("obligations").select("week").eq("season", season);
  if (error) throw new Error(`Supabase week query failed: ${error.message}`);
  return [...new Set((data ?? []).map((row) => Number(row.week)))].filter(Number.isFinite);
}

export async function listObligations(): Promise<Obligation[]> {
  const db = getDb();
  const { data, error } = await db
    .from("obligations")
    .select("*")
    .order("week", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []) as Obligation[];
}

export async function setObligationCompleted(id: string, completed: boolean): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("obligations")
    .update({
      completed,
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}
