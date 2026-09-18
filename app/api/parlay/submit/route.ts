import { getCurrentParlayContext, getEligiblePlayer, getTeamContext } from "@/lib/parlay";
import { upsertParlaySubmission } from "@/lib/parlay-db";
import { getFanDuelProps } from "@/lib/sports-odds";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { teamId?: number; espnPlayerId?: number; oddId?: string; line?: string | null; odds?: string };
    const teamId = Number(body.teamId);
    const espnPlayerId = Number(body.espnPlayerId);
    const oddId = String(body.oddId ?? "");
    if (!Number.isInteger(teamId) || !Number.isInteger(espnPlayerId) || !oddId) {
      return Response.json({ ok: false, error: "Incomplete parlay selection." }, { status: 400 });
    }

    const context = await getCurrentParlayContext();
    if (context.locked || Date.now() >= new Date(context.deadlineAt).getTime()) {
      return Response.json({ ok: false, error: "Picks locked Sunday at 10:30 AM CT." }, { status: 409 });
    }
    const team = getTeamContext(context, teamId);
    const player = getEligiblePlayer(context, teamId, espnPlayerId);
    const props = await getFanDuelProps({ player, sundayDate: context.sundayDate, week: context.week });
    const selected = props.props.find((prop) => prop.oddId === oddId);
    if (!selected) return Response.json({ ok: false, error: "That FanDuel line is no longer available. Refresh the player's props." }, { status: 409 });
    const displayedLine = body.line === undefined || body.line === null ? null : String(body.line);
    const displayedOdds = body.odds === undefined ? "" : String(body.odds);
    if (selected.line !== displayedLine || selected.odds !== displayedOdds) {
      return Response.json({ ok: false, error: "That FanDuel line moved since you opened it. Refresh the player's props before submitting." }, { status: 409 });
    }
    if (new Date(selected.eventStartsAt).getTime() <= Date.now()) {
      return Response.json({ ok: false, error: "That player's NFL game has already started." }, { status: 409 });
    }

    const saved = await upsertParlaySubmission({
      season: context.season,
      week: context.week,
      team_id: team.teamId,
      team_name: team.teamName,
      opponent_team_id: team.opponentTeamId,
      opponent_team_name: team.opponentTeamName,
      espn_player_id: player.espnPlayerId,
      player_name: player.name,
      player_position: player.position,
      sportsbook_player_id: selected.playerId,
      event_id: selected.eventId,
      event_starts_at: selected.eventStartsAt,
      market_id: selected.oddId,
      market_name: selected.marketName,
      stat_id: selected.statId,
      side_id: selected.sideId,
      line: selected.line,
      odds: selected.odds,
      bookmaker: "fanduel"
    });
    return Response.json({ ok: true, submission: saved });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save pick." }, { status: 500 });
  }
}
