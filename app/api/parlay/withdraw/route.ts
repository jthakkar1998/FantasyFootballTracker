import { getCurrentParlayContext, getTeamContext } from "@/lib/parlay";
import { withdrawParlaySubmission } from "@/lib/parlay-db";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { teamId?: number };
    const teamId = Number(body.teamId);
    if (!Number.isInteger(teamId)) return Response.json({ ok: false, error: "Choose a fantasy team." }, { status: 400 });
    const context = await getCurrentParlayContext();
    if (context.locked || Date.now() >= new Date(context.deadlineAt).getTime()) {
      return Response.json({ ok: false, error: "Picks locked Sunday at 10:30 AM CT." }, { status: 409 });
    }
    getTeamContext(context, teamId);
    await withdrawParlaySubmission(context.season, context.week, teamId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not withdraw pick." }, { status: 500 });
  }
}
