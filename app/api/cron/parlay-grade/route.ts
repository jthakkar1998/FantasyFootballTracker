import { runAutoGrading } from "@/lib/parlay-auto-grade";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reuses the narrowly scoped Supabase -> Vercel reminder/snapshot token.
// The preview flag is read-only; actual writes require a SECOND env toggle
// and an authorized Monday/Tuesday Central-time grading window.
export async function GET(request: Request) {
  const secret = process.env.PARLAY_REMINDER_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const rawWeek = params.get("week");
  if (rawWeek !== null && !dryRun) {
    return Response.json({ ok: false, error: "Specific-week requests are preview-only." }, { status: 400 });
  }
  const week = rawWeek === null ? undefined : Number(rawWeek);
  if (rawWeek !== null && !/^\d{1,2}$/.test(rawWeek)) {
    return Response.json({ ok: false, error: "Invalid week." }, { status: 400 });
  }
  try {
    const outcome = await runAutoGrading({ dryRun, week });
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Auto-grade job failed" }, { status: 500 });
  }
}
