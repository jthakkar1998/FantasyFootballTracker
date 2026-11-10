import { runLiveHitNotifications } from "@/lib/parlay-live-hits";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same dedicated Supabase -> Vercel scoped secret as reminder/snapshot Cron.
export async function GET(request: Request) {
  const secret = process.env.PARLAY_REMINDER_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const result = await runLiveHitNotifications({ dryRun });
    return Response.json({ ok: true, dryRun, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live parlay alert job failed.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
