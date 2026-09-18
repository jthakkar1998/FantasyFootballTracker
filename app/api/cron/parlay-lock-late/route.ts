import { getCurrentParlayContext } from "@/lib/parlay";
import { ensureParlayWeekLocked } from "@/lib/parlay-db";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const context = await getCurrentParlayContext();
    const locked = await ensureParlayWeekLocked(context);
    return Response.json({ ok: true, season: context.season, week: context.week, deadlineAt: context.deadlineAt, locked });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not lock parlay." }, { status: 500 });
  }
}
