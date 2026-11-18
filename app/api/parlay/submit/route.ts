import { getCurrentParlayContext, getEligiblePlayer, getTeamContext } from "@/lib/parlay";
import { upsertParlaySubmission } from "@/lib/parlay-db";
import { getFanDuelProps, fetchSnapshotFanDuelMarkets } from "@/lib/sports-odds";
import { parseFanDuelSnapshot } from "@/lib/parlay-snapshot-core";
import { storeSnapshotRows } from "@/lib/parlay-snapshot-db";
import { localDateParts, zonedLocalToIso } from "@/lib/parlay-time";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { teamId?: number; espnPlayerId?: number; oddId?: string; line?: string | null; odds?: string; submittedBy?: string; paymentConfirmed?: boolean };
    const teamId = Number(body.teamId);
    const espnPlayerId = Number(body.espnPlayerId);
    const oddId = String(body.oddId ?? "");
    const submittedBy = String(body.submittedBy ?? "").trim();
    if (!body.paymentConfirmed || submittedBy.length < 2 || submittedBy.length > 80) {
      return Response.json({ ok: false, error: "Enter your name and confirm the $1 Venmo payment before submitting." }, { status: 400 });
    }
    if (!Number.isInteger(teamId) || !Number.isInteger(espnPlayerId) || !oddId) {
      return Response.json({ ok: false, error: "Incomplete parlay selection." }, { status: 400 });
    }

    const context = await getCurrentParlayContext();
    if (context.locked || Date.now() >= new Date(context.deadlineAt).getTime()) {
      return Response.json({ ok: false, error: "Picks locked Sunday at 11:55 AM CT." }, { status: 409 });
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

    // Odds lookup can take several seconds; reject if it crossed the Sunday cutoff.
    if (Date.now() >= new Date(context.deadlineAt).getTime()) {
      return Response.json({ ok: false, error: "Picks locked Sunday at 11:55 AM CT." }, { status: 409 });
    }
    const saved = await upsertParlaySubmission({
      season: context.season,
      week: context.week,
      team_id: team.teamId,
      team_name: team.teamName,
      opponent_team_id: team.opponentTeamId,
      opponent_team_name: team.opponentTeamName,
      espn_player_id: player.espnPlayerId,
      pro_team_id: player.proTeamId,
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
      bookmaker: "fanduel",
      submitted_by_name: submittedBy,
      payment_confirmed_at: new Date().toISOString()
    });
    // Picks placed after the 8 AM preliminary capture but before an early
    // kickoff need their own exact, provider-verified, pregame quote.
    // Never alter the original bet if the market fetch fails: expose a clear
    // warning and keep the selection pending commissioner review.
    let snapshotWarning: string | null = null;
    const now = new Date().toISOString();
    const earlyStart = Date.parse(zonedLocalToIso(context.sundayDate, 8, 0, "America/Chicago"));
    const gameStart = Date.parse(saved.event_starts_at);
    const elevenFortyFive = Date.parse(zonedLocalToIso(context.sundayDate, 11, 45, "America/Chicago"));
    if (process.env.PARLAY_SNAPSHOTS_ENABLED === "true" &&
      localDateParts(now, "America/Chicago").date === context.sundayDate &&
      Date.parse(now) >= earlyStart && gameStart < elevenFortyFive) {
      try {
        const matches = await fetchSnapshotFanDuelMarkets([{ eventId: saved.event_id, oddId: saved.market_id }]);
        const parsed = parseFanDuelSnapshot({ pick: saved, event: matches.find(event => event.eventID === saved.event_id),
          slot: "submission", capturedAt: new Date().toISOString() });
        if (!parsed.record) snapshotWarning = parsed.reason ?? "Unable to verify a pregame quote.";
        else await storeSnapshotRows([parsed.record]);
      } catch (error) {
        snapshotWarning = error instanceof Error ? error.message : "Unable to save early-game snapshot.";
      }
    }
    return Response.json({ ok: true, submission: saved, snapshotWarning });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save pick." }, { status: 500 });
  }
}
