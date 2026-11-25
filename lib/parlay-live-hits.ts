import { leagueConfig } from "./config";
import { fetchLeagueSummary } from "./espn";
import { fetchNflWeekEvents } from "./nfl";
import { verifiedNflSundayDate } from "./nfl-week-calendar";
import { listParlaySubmissions, getCachedOdds, setCachedOdds } from "./parlay-db";
import { listParlayWeeklyTeamTracking } from "./parlay-tracking-db";
import { listOffAppLegs } from "./parlay-offapp";
import { listSnapshots } from "./parlay-snapshot-db";
import { getDb } from "./supabase";
import { sendWebPush, webPushConfigured, type BrowserPushSubscription } from "./web-push";
import { chicagoLiveHitWindow, inspectWebsiteLiveReadiness, type LiveHitPick } from "./parlay-live-hit-core";
import { reconcileTicket, evaluateTicketLeg, hitBroadcastCopy, deadBroadcastCopy, leagueHitAlertGate, type TicketLeg } from "./parlay-ticket-core";
import type { EspnNflSummary } from "./parlay-grade-core";
import type { NflEvent } from "./types";

const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const MIN_WEEK = Number(process.env.PARLAY_LIVE_HITS_MIN_WEEK ?? "10");

interface RegisteredPhone { id: string; team_id: number; endpoint: string; subscription: BrowserPushSubscription }
interface TicketDelivery { alert_key: string; subscription_id: string; status: string; attempt_count: number }
interface TicketState { status: "alive" | "dead"; dead_alert_key: string | null; dead_reason: string | null }
export interface LiveHitPreviewRow {
  team: string; player: string; statId: string; side: string; line: string | null;
  actualValue: number | null; gameFinal: boolean; gameStarted: boolean;
  status: "hit" | "miss" | "waiting" | "review";
  reason: string; source: "website" | "offapp";
  readiness: "verified" | "pending" | "attention";
  readinessReason: string;
}
export interface LiveHitRunResult {
  status: "disabled" | "no_window" | "empty" | "preview" | "sent" | "partial";
  season: number; week: number | null; eligiblePicks: number; currentlyHitting: number;
  registeredDevices: number; attempted: number; sent: number; failed: number; skipped: number;
  ticketStatus: "alive" | "dead" | "needs_verification" | "unknown";
  /** Structural/identity/snapshot problems block the entire ticket. */
  unresolved: string[]; noBetCount: number;
  /** Scheduled lock/snapshot still outstanding: not automatically ineligible. */
  pendingChecks: string[];
  /** Live statistics only: never block an independent, verified hit. */
  liveStatWarnings: string[];
  readiness: "ready" | "pending" | "attention" | "dead" | "unknown";
  verifiedLegs: number;
  rows: LiveHitPreviewRow[]; errors: string[]; note: string;
}

async function nflSummary(eventId: string): Promise<EspnNflSummary> {
  const response = await fetch(`${ESPN_SUMMARY}?${new URLSearchParams({ event: eventId })}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`ESPN summary HTTP ${response.status}`);
  return await response.json() as EspnNflSummary;
}
async function teamIdsForLeague(allowCacheWrite = true): Promise<number[]> {
  const key = `ticket:verified-roster:${leagueConfig.season}`;
  const cached = await getCachedOdds<number[]>(key);
  if (cached && cached.payload.length === 10 && Date.now() - Date.parse(cached.fetchedAt) < 7 * 86_400_000) return cached.payload;
  try {
    const summary = await fetchLeagueSummary();
    const ids = (summary.teams ?? []).map(t => t.id);
    if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error("League roster not uniquely verified as 10 teams.");
    if (allowCacheWrite) await setCachedOdds(key, ids, new Date().toISOString());
    return ids;
  } catch (error) {
    if (cached && cached.payload.length === 10 && Date.now() - Date.parse(cached.fetchedAt) < 30 * 86_400_000) return cached.payload;
    throw error;
  }
}
function matchingNflGame(events: NflEvent[], leg: TicketLeg): NflEvent | null {
  const starts = Date.parse(leg.eventStartsAt);
  const found = events.filter(event => Number.isFinite(starts) &&
    Math.abs(Date.parse(event.date) - starts) <= 3 * 3_600_000 &&
    (!leg.nflEventId || leg.nflEventId === event.id) &&
    (event.competitions?.[0]?.competitors ?? []).some(c => Number(c.team?.id) === leg.proTeamId));
  return found.length === 1 ? found[0] : null;
}
function canSend(delivery: TicketDelivery | undefined) {
  return !delivery || (delivery.status !== "sent" && delivery.status !== "expired" && delivery.attempt_count < 3);
}

/** New league-wide workflow; NEVER call the legacy individual-team delivery RPC.
 * The league broadcast is opt-in independently from the previous live-hit flag.
 * A false gate makes the already-active Cron safe across deployment/migration. */
export async function runLiveHitNotifications(args: { dryRun: boolean; nowIso?: string }): Promise<LiveHitRunResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const result: LiveHitRunResult = {
    status: args.dryRun ? "preview" : "sent", season: leagueConfig.season, week: null,
    eligiblePicks: 0, currentlyHitting: 0, registeredDevices: 0,
    attempted: 0, sent: 0, failed: 0, skipped: 0, ticketStatus: "unknown",
    unresolved: [], pendingChecks: [], liveStatWarnings: [], noBetCount: 0,
    readiness: "unknown", verifiedLegs: 0, rows: [], errors: [], note: ""
  };
  if (!args.dryRun && (process.env.PARLAY_LIVE_HITS_ENABLED !== "true" ||
      process.env.PARLAY_LEAGUE_TICKET_NOTIFICATIONS_ENABLED !== "true")) {
    return { ...result, status: "disabled", note: "League-wide live notifications are disabled until the new migration and verification are complete." };
  }
  if (!Number.isInteger(MIN_WEEK) || MIN_WEEK < 1 || MIN_WEEK > 22) throw new Error("Invalid minimum live-hit week.");
  const window = chicagoLiveHitWindow(nowIso);
  if (!window.active || !window.sundayDate) return { ...result, status: "no_window", note: "Outside Sunday 8:15 AM–Monday 3 AM Central monitoring window. No ESPN/push checks performed." };
  if (!args.dryRun && !webPushConfigured()) throw new Error("VAPID Web Push credentials are not configured.");
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1).filter(w => verifiedNflSundayDate(leagueConfig.season, w) === window.sundayDate && w >= MIN_WEEK);
  if (weeks.length !== 1) return { ...result, status: "empty", note: "No uniquely verified NFL fantasy week matches this Sunday." };
  const week = weeks[0]; result.week = week;

  const [website, trackingAll, offapp, snapshots, roster, subscriptionsResponse, stateResponse, deliveryResponse] = await Promise.all([
    listParlaySubmissions(leagueConfig.season, week),
    listParlayWeeklyTeamTracking(leagueConfig.season),
    listOffAppLegs(leagueConfig.season, week),
    listSnapshots(leagueConfig.season, week),
    teamIdsForLeague(!args.dryRun),
    getDb().from("parlay_push_subscriptions").select("id,team_id,endpoint,subscription"),
    getDb().from("parlay_ticket_state").select("status,dead_alert_key,dead_reason").eq("season",leagueConfig.season).eq("week",week).maybeSingle(),
    getDb().from("parlay_ticket_alert_deliveries").select("alert_key,subscription_id,status,attempt_count").eq("season",leagueConfig.season).eq("week",week)
  ]);
  if (subscriptionsResponse.error || stateResponse.error || deliveryResponse.error) throw new Error(
    `Ticket broadcast data unavailable: ${subscriptionsResponse.error?.message ?? stateResponse.error?.message ?? deliveryResponse.error?.message}`);
  const state = stateResponse.data as TicketState | null;
  const phones = (subscriptionsResponse.data ?? []) as RegisteredPhone[];
  result.registeredDevices = phones.length;
  const existing = new Map<string,TicketDelivery>();
  for (const delivery of (deliveryResponse.data ?? []) as TicketDelivery[]) existing.set(`${delivery.alert_key}:${delivery.subscription_id}`, delivery);
  const tracking = trackingAll.filter(t => t.week === week);
  const ticket = reconcileTicket({ teamIds: roster, websitePicks: website, offapp, tracking });
  result.noBetCount = ticket.noBetCount;
  result.unresolved.push(...ticket.unresolved);
  result.eligiblePicks = ticket.legs.length;
  if (!args.dryRun) {
    const { error } = await getDb().from("parlay_ticket_state").upsert({ season: leagueConfig.season, week },
      { onConflict: "season,week", ignoreDuplicates: true });
    if (error) throw new Error(`Unable to initialize ticket status: ${error.message}`);
  }

  let dead: { key: string; teamId: number; title: string; body: string } | null = null;
  if (state?.status === "dead") {
    dead = { key: state.dead_alert_key ?? "", teamId: 0, title: "League parlay is DEAD!",
      body: state.dead_reason ?? "A verified losing leg ended the league ticket. No more hit alerts this week." };
    result.ticketStatus = "dead";
  } else if (ticket.manualLoss) {
    const m = ticket.manualLoss;
    dead = { key: m.key, teamId: m.teamId, ...deadBroadcastCopy(m.teamName, m.player, m.description) };
  }

  const hits: Array<{ leg: TicketLeg; key: string; actual: number; final: boolean }> = [];
  if (!dead) {
    const events = await fetchNflWeekEvents(week, { readOnly: args.dryRun });
    const eventByLeg = new Map<string,NflEvent>();
    const checkByLeg = new Map<string,string>();
    for (const leg of ticket.legs) {
      if (leg.source === "website") {
        const check = inspectWebsiteLiveReadiness(leg.websitePick as LiveHitPick, snapshots, nowIso);
        if (check.status !== "verified") {
          const issue = `${leg.teamName}: ${check.reason}`;
          if (check.status === "pending") result.pendingChecks.push(issue);
          else result.unresolved.push(issue);
          result.rows.push({ team: leg.teamName, player: leg.playerName, statId: leg.statId,
            side: leg.side, line: check.line, actualValue: null, gameFinal: false,
            gameStarted: Date.parse(leg.eventStartsAt) <= Date.parse(nowIso),
            status: check.status === "pending" ? "waiting" : "review", source: leg.source,
            reason: check.reason, readiness: check.status, readinessReason: check.reason });
          continue;
        }
        leg.line = check.line;
        checkByLeg.set(leg.key, check.reason);
      } else {
        checkByLeg.set(leg.key, "Commissioner-confirmed structured off-app wager.");
      }
      const event = matchingNflGame(events, leg);
      if (!event) {
        const reason = "Could not uniquely verify the player's NFL game and kickoff time.";
        result.unresolved.push(`${leg.teamName}: ${reason}`);
        result.rows.push({ team: leg.teamName, player: leg.playerName, statId: leg.statId,
          side: leg.side, line: leg.line, actualValue: null, gameFinal: false,
          gameStarted: false, status: "review", source: leg.source, reason,
          readiness: "attention", readinessReason: reason });
        continue;
      }
      eventByLeg.set(leg.key, event);
      result.verifiedLegs++;
    }
    const started = [...new Set([...eventByLeg.values()].filter(event => Date.parse(event.date) <= Date.parse(nowIso)).map(e => e.id))];
    const summaries = new Map<string,EspnNflSummary | Error>();
    for (let offset=0; offset<started.length; offset+=4) {
      await Promise.all(started.slice(offset,offset+4).map(async eventId => {
        try { summaries.set(eventId, await nflSummary(eventId)); }
        catch (error) { summaries.set(eventId, error instanceof Error ? error : new Error("NFL box score unavailable.")); }
      }));
    }
    for (const leg of ticket.legs) {
      const event = eventByLeg.get(leg.key); if (!event) continue;
      if (Date.parse(event.date) > Date.parse(nowIso)) {
        result.rows.push({ team: leg.teamName, player: leg.playerName, statId: leg.statId, side: leg.side,
          line: leg.line, actualValue: null, gameFinal: false, gameStarted: false,
          status: "waiting", source: leg.source, reason: "Awaiting kickoff; live NFL statistics are not required yet.",
          readiness: "verified", readinessReason: `${checkByLeg.get(leg.key)} NFL game and kickoff confirmed.` });
        continue;
      }
      const summary = summaries.get(event.id);
      if (!summary || summary instanceof Error) {
        const reason = summary instanceof Error ? summary.message : "NFL box score unavailable.";
        result.liveStatWarnings.push(`${leg.teamName}: ${reason}`);
        result.rows.push({ team: leg.teamName, player: leg.playerName, statId: leg.statId,
          side: leg.side, line: leg.line, actualValue: null, gameFinal: false,
          gameStarted: true, status: "review", reason, source: leg.source,
          readiness: "verified", readinessReason: `${checkByLeg.get(leg.key)} NFL game and kickoff confirmed.` });
        continue;
      }
      const verdict = evaluateTicketLeg(summary, leg);
      result.rows.push({ team: leg.teamName, player: leg.playerName, statId: leg.statId,
        side: leg.side, line: leg.line, actualValue: verdict.actualValue,
        gameFinal: verdict.final, gameStarted: true, status: verdict.state, reason: verdict.reason, source: leg.source,
        readiness: "verified", readinessReason: `${checkByLeg.get(leg.key)} NFL game and kickoff confirmed.` });
      if (verdict.state === "miss") {
        dead = { key: `dead:${leg.key}`, teamId: leg.teamId,
          ...deadBroadcastCopy(leg.teamName, leg.playerName, `${leg.side.toUpperCase()} ${leg.line ?? ""} ${leg.statId} (final NFL stat ${verdict.actualValue})`) };
        break;
      }
      if (verdict.state === "review") result.liveStatWarnings.push(`${leg.teamName}: ${verdict.reason}`);
      if (verdict.state === "hit" && verdict.actualValue !== null && leg.allowLiveHit)
        hits.push({ leg, key: `hit:${leg.key}`, actual: verdict.actualValue, final: verdict.final });
    }
  }

  result.currentlyHitting = hits.length;
  const gate = leagueHitAlertGate({ unresolvedSelections: result.unresolved,
    pendingPregameChecks: result.pendingChecks, liveStatWarnings: result.liveStatWarnings });
  result.readiness = dead ? "dead" : result.unresolved.length ? "attention" :
    result.pendingChecks.length ? "pending" : "ready";
  if (dead) {
    result.ticketStatus = "dead";
    // First definitive miss permanently seals this week's league ticket.
    if (!args.dryRun && state?.status !== "dead") {
      const { data, error } = await getDb().rpc("mark_parlay_ticket_dead", {
        p_season: leagueConfig.season, p_week: week, p_alert_key: dead.key, p_reason: dead.body
      });
      if (error) throw new Error(`Could not seal dead ticket: ${error.message}`);
      if (data !== dead.key) {
        dead = { key: String(data ?? ""), teamId: 0, title: "League parlay is DEAD!",
          body: "A verified losing leg ended the league ticket. No more hit alerts this week." };
      }
    }
  } else if (!gate.canSendHits) result.ticketStatus = "needs_verification";
  else result.ticketStatus = "alive";
  if (args.dryRun) {
    result.note = `READ ONLY: ${gate.reason} No pushes, grades, payments, or ticket status updated.`;
    return result;
  }
  if (result.ticketStatus === "needs_verification") {
    result.note = gate.reason;
    return result;
  }
  const alerts = dead ? [dead] : hits.map(h => ({ key: h.key, teamId: h.leg.teamId,
    ...hitBroadcastCopy(h.leg, h.actual, h.final) }));
  for (const alert of alerts) {
    const isDead = alert.key.startsWith("dead:");
    await Promise.all(phones.map(async phone => {
      if (!canSend(existing.get(`${alert.key}:${phone.id}`))) { result.skipped++; return; }
      const { data: claimRows, error: claimError } = await getDb().rpc("claim_parlay_ticket_alert", {
        p_season: leagueConfig.season, p_week: week, p_alert_key: alert.key,
        p_kind: isDead ? "dead" : "hit", p_source_team_id: alert.teamId, p_subscription_id: phone.id
      });
      if (claimError) { result.failed++; result.errors.push(claimError.message); return; }
      const claim = (claimRows as Array<{ delivery_id: string; attempts: number }> | null)?.[0];
      if (!claim) { result.skipped++; return; }
      result.attempted++;
      if (!isDead) {
        const { data: currentState, error: stateError } = await getDb().from("parlay_ticket_state")
          .select("status").eq("season", leagueConfig.season).eq("week", week).maybeSingle();
        if (stateError || currentState?.status !== "alive") {
          await getDb().from("parlay_ticket_alert_deliveries")
            .update({ status: "failed", last_error: "Ticket closed before push sending." })
            .eq("id", claim.delivery_id).eq("attempt_count", claim.attempts);
          result.skipped++;
          return;
        }
      }
      let code: number | null = null;
      let status: "sent" | "failed" | "expired" = "failed";
      let message: string | null = null;
      try {
        code = await sendWebPush(phone.subscription, { title: alert.title, body: alert.body,
          url: "/parlay", urgent: isDead,
          tag: `ffball-${leagueConfig.season}-${week}-${alert.key}` });
        if (code >= 200 && code < 300) status = "sent";
        else if (code === 404 || code === 410) status = "expired";
        else message = `Web Push provider HTTP ${code}`;
      } catch (e) { message = e instanceof Error ? e.message.slice(0,300) : "Push failed"; }
      const { error: updateError } = await getDb().from("parlay_ticket_alert_deliveries")
        .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null,
          last_http_status: code, last_error: message })
        .eq("id", claim.delivery_id).eq("attempt_count", claim.attempts).eq("status", "attempting");
      if (updateError) { result.failed++; result.errors.push(updateError.message); return; }
      if (status === "sent") result.sent++;
      else {
        result.failed++; if (message) result.errors.push(message);
        if (status === "expired") {
          const { error } = await getDb().from("parlay_push_subscriptions")
            .delete().eq("id",phone.id).eq("endpoint",phone.endpoint);
          if (error) result.errors.push(error.message);
        }
      }
    }));
  }
  result.status = result.failed || result.errors.length ? "partial" : "sent";
  const { error } = await getDb().from("parlay_live_hit_runs").insert({
    season: leagueConfig.season, week, finished_at: new Date().toISOString(),
    status: result.failed || result.errors.length ? "partial" : result.attempted ? "success" : "idle",
    eligible_picks: result.eligiblePicks, currently_hitting: result.currentlyHitting,
    attempted: result.attempted, sent: result.sent, failed: result.failed,
    skipped: result.skipped, errors: result.errors
  });
  if (error) result.errors.push(`Unable to log live alerts: ${error.message}`);
  result.note = dead ? "Ticket dead: one league-wide loss alert and no further hit alerts." :
    "League-wide hit alerts sent for verified threshold crossings. Official grades remain separate.";
  return result;
}
