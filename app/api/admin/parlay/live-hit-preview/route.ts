import { isAdmin } from "@/lib/auth";
import { runLiveHitNotifications } from "@/lib/parlay-live-hits";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const result = await runLiveHitNotifications({ dryRun: true });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Live preview failed." }, { status: 500 });
  }
}
