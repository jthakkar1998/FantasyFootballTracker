import { commissionerWriteBlocked } from "@/lib/commissioner-write-guard";
import { isAdmin } from "@/lib/auth";
import { saveOffAppLeg, type OffAppInput } from "@/lib/parlay-offapp";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const blocked = commissionerWriteBlocked();
  if (blocked) return blocked;
  if (!(await isAdmin())) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input: OffAppInput = {
      week: Number(body.week), teamId: Number(body.teamId), espnPlayerId: Number(body.espnPlayerId),
      statId: String(body.statId ?? ""), sideId: String(body.sideId ?? "") as OffAppInput["sideId"],
      line: body.line === null || body.line === undefined || String(body.line).trim() === "" ? null : String(body.line).trim(),
      bookName: String(body.bookName ?? ""), notes: String(body.notes ?? ""), confirmed: body.confirmed === true
    };
    const leg = await saveOffAppLeg(input);
    return Response.json({ ok: true, leg });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save off-app leg." }, { status: 400 });
  }
}
