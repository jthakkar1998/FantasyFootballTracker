import { getDb } from "@/lib/supabase";
import { runParlayReminders } from "@/lib/parlay-notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

// This token is ONLY for Supabase Cron, separate from CRON_SECRET used by
// Vercel's ESPN and parlay-lock jobs. Configure it in Vercel and Supabase Vault.
export async function GET(request: Request) {
  const expected = process.env.PARLAY_REMINDER_CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const { data: started, error: insertError } = await getDb().from("parlay_reminder_runs")
    .insert({ status: "running" }).select("id").single();
  if (insertError || !started) {
    return Response.json({ ok: false, error: "Could not start reminder diagnostics." }, { status: 500 });
  }
  try {
    const result = await runParlayReminders(new Date().toISOString(), { dryRun });
    const status = dryRun ? "preview" : !result.slot ? "no_window" : result.failed ? "partial" : "success";
    const { error } = await getDb().from("parlay_reminder_runs").update({
      status, finished_at: new Date().toISOString(), slot: result.slot,
      missing_teams: result.missingTeams, registered_devices: result.registeredDevices,
      eligible_devices: result.eligibleDevices, attempted: result.attempted, retried: result.retried,
      sent: result.sent, skipped: result.skipped, failed: result.failed
    }).eq("id", started.id);
    if (error) throw new Error(`Could not save reminder diagnostics: ${error.message}`);
    return Response.json({ ok: true, dryRun, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send parlay reminders.";
    await getDb().from("parlay_reminder_runs").update({
      status: "error", finished_at: new Date().toISOString(), error_message: message.slice(0, 500)
    }).eq("id", started.id);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
