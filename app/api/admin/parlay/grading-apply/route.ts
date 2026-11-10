import { isAdmin } from "@/lib/auth";
import { runAutoGrading } from "@/lib/parlay-auto-grade";

export const runtime = "nodejs";
export const maxDuration = 60;

// Exception to the cron time window: a signed-in commissioner may explicitly
// approve a historical week AFTER checking the read-only grading preview.
// The enable flag and all per-pick DB safety checks still apply.
export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ ok: false, error: "Same-origin commissioner request required." }, { status: 403 });
  }
  if (process.env.PARLAY_AUTO_GRADING_ENABLED !== "true") {
    return Response.json({ ok: false, error: "Auto-grade writes are disabled in Vercel Production." }, { status: 409 });
  }
  try {
    const body = await request.json() as { week?: unknown; confirmation?: unknown };
    const week = Number(body.week);
    if (!Number.isInteger(week) || week < 1 || week > 22 ||
        body.confirmation !== `APPLY_WEEK_${week}`) {
      return Response.json({ ok: false, error: "Explicit week confirmation required." }, { status: 400 });
    }
    const result = await runAutoGrading({ dryRun: false, week, commissionerApply: true });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not apply grades" }, { status: 500 });
  }
}
