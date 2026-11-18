import { extractEspnNflMetric, gradeStat, isNflBoxscoreFinal, type EspnNflSummary } from "./parlay-grade-core";
import type { OffAppLeg } from "./parlay-offapp";
import type { ParlaySubmission } from "./parlay-types";
import type { ParlayWeeklyTeamTracking } from "./parlay-admin";

export type TicketLeg = {
  key: string;
  source: "website" | "offapp";
  teamId: number;
  teamName: string;
  playerName: string;
  espnPlayerId: number;
  proTeamId: number;
  eventStartsAt: string;
  nflEventId?: string;
  statId: string;
  side: string;
  line: string | null;
  // Off-app selections recorded after kickoff must never create retroactive
  // "just hit" messages, but a verified final loss can still kill the ticket.
  allowLiveHit: boolean;
  websitePick?: ParlaySubmission;
};
export interface TicketReconciliation {
  legs: TicketLeg[];
  unresolved: string[];
  manualLoss: { key: string; reason: string; teamId: number; teamName: string; player: string; description: string } | null;
  noBetCount: number;
}

export function reconcileTicket(input: {
  teamIds: number[];
  websitePicks: ParlaySubmission[];
  offapp: OffAppLeg[];
  tracking: ParlayWeeklyTeamTracking[];
}): TicketReconciliation {
  const legs: TicketLeg[] = [], unresolved: string[] = [];
  let manualLoss: TicketReconciliation["manualLoss"] = null;
  let noBetCount = 0;
  const duplicate = input.teamIds.length !== new Set(input.teamIds).size;
  if (duplicate || input.teamIds.length !== 10) unresolved.push("League team roster must contain exactly 10 unique teams.");
  for (const teamId of input.teamIds) {
    const websites = input.websitePicks.filter(p => p.team_id === teamId && !p.withdrawn_at);
    const tracked = input.tracking.find(t => t.team_id === teamId);
    const structured = input.offapp.find(p => p.team_id === teamId);
    if (websites.length > 1) { unresolved.push(`Team ${teamId}: multiple active website picks.`); continue; }
    const website = websites[0];
    if (website) {
      if (tracked?.submitted_outside_app) unresolved.push(`Team ${teamId}: conflicting website and off-app records.`);
      if (website.result_status === "miss" && !manualLoss) {
        manualLoss = { key: `dead:website:${website.id}`, reason: "Commissioner/official result is Miss",
          teamId, teamName: website.team_name, player: website.player_name,
          description: `${website.side_id.toUpperCase()} ${website.line ?? ""} ${website.stat_id}` };
      }
      if (website.result_status === "void" || website.result_status === "push") continue;
      legs.push({ key: `website:${website.id}`, source: "website", teamId, teamName: website.team_name,
        playerName: website.player_name, espnPlayerId: website.espn_player_id,
        proTeamId: Number(website.pro_team_id), eventStartsAt: website.event_starts_at,
        statId: website.stat_id, side: website.side_id, line: website.line,
        allowLiveHit: true, websitePick: website });
      continue;
    }
    if (tracked?.submitted_outside_app) {
      if (tracked.outside_result_status === "miss" && !manualLoss) {
        manualLoss = { key: `dead:offapp:team:${teamId}`, reason: "Commissioner confirmed off-app result Miss",
          teamId, teamName: structured?.team_name ?? `Team ${teamId}`,
          player: structured?.player_name ?? "Off-app selection",
          description: structured ? `${structured.side_id.toUpperCase()} ${structured.line ?? ""} ${structured.stat_id}` : tracked.outside_bet_details ?? "Off-app pick" };
      }
      if (tracked.outside_result_status === "void" || tracked.outside_result_status === "push") continue;
      if (!structured?.confirmed || structured.season !== tracked.season || structured.week !== tracked.week) {
        unresolved.push(`Team ${teamId}: off-app bet is not recorded as a verified structured leg.`);
        continue;
      }
      legs.push({ key: `offapp:${structured.id}`, source: "offapp", teamId,
        teamName: structured.team_name, playerName: structured.player_name,
        espnPlayerId: structured.espn_player_id, proTeamId: structured.pro_team_id,
        eventStartsAt: structured.event_starts_at, nflEventId: structured.nfl_event_id,
        statId: structured.stat_id, side: structured.side_id, line: structured.line,
        allowLiveHit: Date.parse(structured.recorded_at) < Date.parse(structured.event_starts_at) });
      continue;
    }
    if (tracked?.outside_result_status === "no_bet") { noBetCount++; continue; }
    unresolved.push(`Team ${teamId}: no website pick, verified off-app pick, or No Bet Placed confirmation.`);
  }
  return { legs, unresolved, manualLoss, noBetCount };
}

export type TicketVerdict = {
  state: "hit" | "miss" | "waiting" | "review";
  final: boolean;
  actualValue: number | null;
  reason: string;
};
export function evaluateTicketLeg(summary: EspnNflSummary, leg: Pick<TicketLeg, "statId" | "side" | "line" | "espnPlayerId">): TicketVerdict {
  const final = isNflBoxscoreFinal(summary);
  const metric = extractEspnNflMetric(summary, leg.espnPlayerId, leg.statId);
  if (metric.value === null) return { state: "review", final, actualValue: null, reason: metric.reason ?? "Statistic unavailable" };
  const compared = gradeStat({ statId: leg.statId, side: leg.side, line: leg.line,
    value: metric.value, possibleOtherTouchdowns: metric.possibleOtherTouchdowns });
  if (!compared.result) return { state: "review", final, actualValue: metric.value, reason: compared.reason };
  if (compared.result === "miss") return { state: final ? "miss" : "waiting", final, actualValue: metric.value,
    reason: final ? "Verified final box score falls short of this prop." : "Game not final; loss cannot be confirmed yet." };
  if (compared.result === "push") return { state: final ? "review" : "waiting", final, actualValue: metric.value, reason: "Push needs sportsbook/commissioner settlement." };
  if ((leg.side === "under" || leg.side === "no") && !final) return {
    state: "waiting", final, actualValue: metric.value, reason: "Under/No requires a final game." };
  return { state: "hit", final, actualValue: metric.value, reason: final ? "Final NFL box score supports Hit." : "Provisional live threshold reached." };
}

export function hitBroadcastCopy(leg: TicketLeg, actual: number, final: boolean) {
  return {
    title: `${leg.teamName}'s parlay leg is hitting!`,
    body: `${leg.playerName}: ${leg.side.toUpperCase()} ${leg.line ?? ""} ${leg.statId.replaceAll("_", " ")} (NFL stat: ${actual}). ${final ? "Final NFL stats; sportsbook settlement pending." : "Live stats; provisional."}`
  };
}
export function deadBroadcastCopy(teamName: string, player: string, description: string) {
  return { title: "League parlay is DEAD!", body: `${teamName}'s leg missed: ${player} — ${description}. No more hit alerts this week. Final settlement may require review.` };
}
