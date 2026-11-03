import { getDb } from "./supabase";

export interface ReminderRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "no_window" | "preview" | "error";
  slot: string | null;
  missing_teams: number;
  registered_devices: number;
  eligible_devices: number;
  attempted: number;
  retried: number;
  sent: number;
  skipped: number;
  failed: number;
  error_message: string | null;
}

export async function recentParlayReminderRuns(limit = 12): Promise<ReminderRun[]> {
  const { data, error } = await getDb().from("parlay_reminder_runs").select("*")
    .order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not load reminder diagnostics: ${error.message}`);
  return (data ?? []) as ReminderRun[];
}
