import { getCurrentParlayContext, getEligiblePlayer } from "@/lib/parlay";
import { getFanDuelProps } from "@/lib/sports-odds";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get("teamId"));
    const espnPlayerId = Number(url.searchParams.get("espnPlayerId"));
    if (!Number.isInteger(teamId) || !Number.isInteger(espnPlayerId)) {
      return Response.json({ ok: false, error: "Choose a fantasy team and player." }, { status: 400 });
    }

    const context = await getCurrentParlayContext();
    if (context.locked) return Response.json({ ok: false, error: "This week's parlay is locked." }, { status: 409 });
    const player = getEligiblePlayer(context, teamId, espnPlayerId);
    const data = await getFanDuelProps({ player, sundayDate: context.sundayDate, week: context.week });
    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not load props." }, { status: 500 });
  }
}
