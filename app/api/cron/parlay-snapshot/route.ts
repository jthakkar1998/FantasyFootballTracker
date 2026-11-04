import { runSundaySnapshots } from "@/lib/parlay-snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same scoped credential as the Supabase reminder scheduler. Do NOT expose
// the older CRON_SECRET used by unrelated Vercel jobs.
export async function GET(request: Request) {
  const secret = process.env.PARLAY_REMINDER_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const result = await runSundaySnapshots({ dryRun });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Snapshot job failed" }, { status: 500 });
  }
}
