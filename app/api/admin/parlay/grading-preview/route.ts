import { isAdmin } from "@/lib/auth";
import { runAutoGrading } from "@/lib/parlay-auto-grade";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams;
  const raw = params.get("week");
  const week = raw === null ? undefined : Number(raw);
  if (raw !== null && (!/^\d{1,2}$/.test(raw) || !Number.isInteger(week))) {
    return Response.json({ error: "Invalid week" }, { status: 400 });
  }
  try {
    const preview = await runAutoGrading({ dryRun: true, week });
    return Response.json({ ok: true, ...preview });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Grading preview unavailable" }, { status: 500 });
  }
}
