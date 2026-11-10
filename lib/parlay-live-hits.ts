import { leagueConfig } from "./config";
import { fetchNflWeekEvents } from "./nfl";
import { listParlaySubmissions } from "./parlay-db";
import { listSnapshots } from "./parlay-snapshot-db";
import { getDb } from "./supabase";
import { sendWebPush, webPushConfigured, type BrowserPushSubscription } from "./web-push";
import {
  chicagoDate, chicagoLiveHitWindow, eligibleLiveHitPick, evaluateLiveHit,
  liveHitNotificationCopy, type LiveHitPick
} from "./parlay-live-hit-core";
import type { EspnNflSummary } from "./parlay-grade-core";
import type { NflEvent } from "./types";

const ESPN_NFL_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const MIN_WEEK = Number(process.env.PARLAY_LIVE_HITS_MIN_WEEK ?? "10");

interface RegisteredPhone {
  id: string;
  team_id: number;
  endpoint: string;
  subscription: BrowserPushSubscription;
}
interface SavedDelivery {
  submission_id: string;
  subscription_id: string;
  status: "sent" | "expired" | "failed" | "attempting";
  attempt_count: number;
}

export interface LiveHitPreviewRow {
  team: string;
  player: string;
  statId: string;
  side: string;
  line: string | null;
  actualValue: number | null;
  gameFinal: boolean;
  status: "hit" | "waiting" | "review";
  reason: string;
}
export interface LiveHitRunResult {
  status: "disabled" | "no_window" | "empty" | "preview" | "sent" | "partial";
  season: number;
  week: number | null;
  eligiblePicks: number;
  currentlyHitting: number;
  registeredDevices: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  rows: LiveHitPreviewRow[];
  errors: string[];
  note: string;
}

async function nflSummary(eventId: string): Promise<EspnNflSummary> {
  const response = await fetch(`${ESPN_NFL_SUMMARY_URL}?${new URLSearchParams({ event: eventId })}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`ESPN NFL summary returned HTTP ${response.status}`);
  return await response.json() as EspnNflSummary;
}

/** Never match a player to a game just by their name or a common kickoff time.
 * The ESPN fantasy proTeamId must identify exactly one NFL scoreboard event. */
function findNflGame(events: NflEvent[], pick: LiveHitPick): NflEvent | null {
  const starts = Date.parse(pick.event_starts_at);
  if (!Number.isFinite(starts)) return null;
  const matched = events.filter(event => {
    const eventStart = Date.parse(event.date);
    return Number.isFinite(eventStart) && Math.abs(eventStart - starts) <= 3 * 60 * 60_000 &&
      (event.competitions?.[0]?.competitors ?? []).some(c => Number(c.team?.id) === pick.pro_team_id);
  });
  return matched.length === 1 ? matched[0] : null;
}

function couldStillNotify(delivery: SavedDelivery | undefined): boolean {
  if (!delivery) return true;
  if (delivery.status === "sent" || delivery.status === "expired") return false;
  return delivery.attempt_count < 3;
}

/** Dry runs make NO writes and send NO pushes, even if the Vercel flag is on.
 * Live calls are triple-gated: Vercel env, Chicago local time, and Supabase Cron
 * private enqueue guard. Historical Week 9 data will never trigger live pushes. */
export async function runLiveHitNotifications(args: { dryRun: boolean; nowIso?: string }): Promise<LiveHitRunResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const empty = (status: LiveHitRunResult["status"], note: string): LiveHitRunResult => ({
    status, season: leagueConfig.season, week: null, eligiblePicks: 0,
    currentlyHitting: 0, registeredDevices: 0, attempted: 0, sent: 0, failed: 0,
    skipped: 0, rows: [], errors: [], note
  });
  if (!args.dryRun && process.env.PARLAY_LIVE_HITS_ENABLED !== "true") {
    return empty("disabled", "Live push notifications are disabled in Vercel. No alerts sent.");
  }
  if (!Number.isInteger(MIN_WEEK) || MIN_WEEK < 1 || MIN_WEEK > 22) {
    throw new Error("Invalid PARLAY_LIVE_HITS_MIN_WEEK. Must be 1–22.");
  }
  const time = chicagoLiveHitWindow(nowIso);
  if (!time.active || !time.sundayDate) {
    return empty("no_window", "Outside the live monitoring window (Sunday noon–Monday 3 AM Chicago time). The preview endpoint is reachable, but no pick, device, or ESPN stat checks were performed. No pushes were sent.");
  }
  if (!args.dryRun && !webPushConfigured()) throw new Error("VAPID Web Push credentials are not configured.");

  // Active snapshot must have been captured THIS Sunday, never a previous week.
  const snapshots = (await listSnapshots(leagueConfig.season)).filter(s =>
    s.snapshot_slot === "primary" && s.week >= MIN_WEEK && chicagoDate(s.captured_at) === time.sundayDate);
  const candidateWeeks = [...new Set(snapshots.map(s => s.week))];
  if (!candidateWeeks.length) return empty("empty", "No primary FanDuel snapshots captured this Sunday. No alerts possible.");
  if (candidateWeeks.length !== 1) throw new Error("Multiple fantasy weeks have primary snapshots for the same Sunday; refusing to alert.");
  const week = candidateWeeks[0];

  const [picks, subscriptionsResponse, sentResponse] = await Promise.all([
    listParlaySubmissions(leagueConfig.season, week),
    getDb().from("parlay_push_subscriptions").select("id,team_id,endpoint,subscription"),
    getDb().from("parlay_live_hit_deliveries")
      .select("submission_id,subscription_id,status,attempt_count")
      .eq("season", leagueConfig.season).eq("week", week)
  ]);
  if (subscriptionsResponse.error) throw new Error(`Unable to read push devices: ${subscriptionsResponse.error.message}`);
  if (sentResponse.error) throw new Error(`Unable to read live alert delivery history: ${sentResponse.error.message}`);
  const phones = (subscriptionsResponse.data ?? []) as RegisteredPhone[];
  const deliveries = new Map<string, SavedDelivery>();
  for (const d of (sentResponse.data ?? []) as SavedDelivery[]) deliveries.set(`${d.submission_id}:${d.subscription_id}`, d);
  const candidates = (picks as LiveHitPick[])
    .map(pick => ({ pick, check: eligibleLiveHitPick(pick, snapshots) }))
    .filter(({ check }) => check.eligible);

  const result: LiveHitRunResult = {
    ...empty(args.dryRun ? "preview" : "sent", "Live game statistics are informational; final grading is separate."),
    week, eligiblePicks: candidates.length, registeredDevices: phones.length
  };
  if (!candidates.length || !phones.some(phone => candidates.some(c => c.pick.team_id === phone.team_id))) {
    result.note = "No eligible snapshotted picks with a registered device. No ESPN NFL calls or pushes needed.";
    return result;
  }
  // Once every device received its notification, stop polling that player.
  const relevant = candidates.filter(({ pick }) => phones.some(phone => phone.team_id === pick.team_id &&
    couldStillNotify(deliveries.get(`${pick.id}:${phone.id}`))));
  if (!relevant.length && !args.dryRun) {
    result.note = "All possible alerts have already been delivered or exhausted retries.";
    return result;
  }
  const items = args.dryRun ? candidates : relevant;
  const events = await fetchNflWeekEvents(week); // single NFL schedule request per run
  const gameByPick = new Map<string, NflEvent>();
  for (const { pick } of items) {
    const event = findNflGame(events, pick);
    if (!event) {
      result.rows.push({ team: pick.team_name, player: pick.player_name, statId: pick.stat_id,
        side: pick.side_id, line: null, actualValue: null, gameFinal: false, status: "review",
        reason: "Could not uniquely verify player's NFL team and Sunday game." });
      continue;
    }
    gameByPick.set(pick.id, event);
  }
  const startedEvents = [...new Set([...gameByPick.values()]
    .filter(event => Date.parse(event.date) <= Date.parse(nowIso)).map(event => event.id))];
  const summaries = new Map<string, EspnNflSummary | Error>();
  for (let i = 0; i < startedEvents.length; i += 4) {
    await Promise.all(startedEvents.slice(i, i + 4).map(async eventId => {
      try { summaries.set(eventId, await nflSummary(eventId)); }
      catch (error) { summaries.set(eventId, error instanceof Error ? error : new Error("NFL stat lookup failed.")); }
    }));
  }

  const sending: Array<Promise<void>> = [];
  for (const { pick, check } of items) {
    const event = gameByPick.get(pick.id);
    if (!event) continue;
    if (Date.parse(event.date) > Date.parse(nowIso)) {
      result.rows.push({ team: pick.team_name, player: pick.player_name, statId: pick.stat_id,
        side: pick.side_id, line: check.line, actualValue: null, gameFinal: false,
        status: "waiting", reason: "NFL game has not kicked off." });
      continue;
    }
    const summary = summaries.get(event.id);
    if (!summary || summary instanceof Error) {
      const reason = summary instanceof Error ? summary.message : "NFL box score unavailable.";
      result.errors.push(`${pick.team_name} / ${pick.player_name}: ${reason}`);
      result.rows.push({ team: pick.team_name, player: pick.player_name, statId: pick.stat_id,
        side: pick.side_id, line: check.line, actualValue: null, gameFinal: false,
        status: "review", reason });
      continue;
    }
    const verdict = evaluateLiveHit(summary, pick, check.line);
    result.rows.push({ team: pick.team_name, player: pick.player_name, statId: pick.stat_id,
      side: pick.side_id, line: check.line, actualValue: verdict.actualValue,
      gameFinal: verdict.final, status: verdict.state, reason: verdict.reason });
    if (verdict.state !== "hit") continue;
    result.currentlyHitting++;
    if (args.dryRun) continue;
    const listeners = phones.filter(phone => phone.team_id === pick.team_id);
    for (const phone of listeners) {
      if (!couldStillNotify(deliveries.get(`${pick.id}:${phone.id}`))) { result.skipped++; continue; }
      sending.push((async () => {
        const { data, error: claimError } = await getDb().rpc("claim_parlay_live_hit_delivery", {
          p_season: leagueConfig.season, p_week: week, p_team_id: pick.team_id,
          p_submission_id: pick.id, p_subscription_id: phone.id,
          p_nfl_event_id: event.id, p_stat_id: pick.stat_id, p_side_id: pick.side_id,
          p_frozen_line: check.line, p_observed_value: verdict.actualValue,
          p_game_final: verdict.final
        });
        if (claimError) { result.failed++; result.errors.push(`Could not reserve push for ${pick.team_name}: ${claimError.message}`); return; }
        const claim = (data as Array<{ delivery_id: string; attempts: number }> | null)?.[0];
        if (!claim) { result.skipped++; return; }
        result.attempted++;
        let status: "sent" | "expired" | "failed" = "failed";
        let code: number | null = null;
        let message: string | null = null;
        try {
          code = await sendWebPush(phone.subscription, {
            ...liveHitNotificationCopy(pick, check.line, verdict.actualValue!, verdict.final),
            url: "/parlay", urgent: false
          });
          if (code >= 200 && code < 300) status = "sent";
          else if (code === 404 || code === 410) status = "expired";
          else message = `Web Push service returned HTTP ${code}.`;
        } catch (error) { message = error instanceof Error ? error.message.slice(0, 300) : "Web Push delivery failed."; }
        // Match the claimed attempt so a stale worker cannot replace a newer status.
        const { error: updateError } = await getDb().from("parlay_live_hit_deliveries")
          .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null,
            last_http_status: code, last_error: message })
          .eq("id", claim.delivery_id).eq("attempt_count", claim.attempts).eq("status", "attempting");
        if (updateError) { result.failed++; result.errors.push(`Could not log notification result: ${updateError.message}`); return; }
        if (status === "sent") result.sent++;
        else {
          result.failed++;
          if (message) result.errors.push(`${pick.team_name}: ${message}`);
          if (status === "expired") {
            // Remove only the expired device, not other members' subscriptions.
            const { error: deleteError } = await getDb().from("parlay_push_subscriptions")
              .delete().eq("id", phone.id).eq("endpoint", phone.endpoint);
            if (deleteError) result.errors.push(`Could not remove expired device: ${deleteError.message}`);
          }
        }
      })());
    }
  }
  await Promise.all(sending);
  if (!args.dryRun) {
    result.status = result.errors.length || result.failed ? "partial" : "sent";
    const { error } = await getDb().from("parlay_live_hit_runs").insert({
      season: leagueConfig.season, week, finished_at: new Date().toISOString(),
      status: result.errors.length || result.failed ? "partial" : result.attempted === 0 ? "idle" : "success",
      eligible_picks: result.eligiblePicks, currently_hitting: result.currentlyHitting,
      attempted: result.attempted, sent: result.sent, failed: result.failed,
      skipped: result.skipped, errors: result.errors
    });
    if (error) result.errors.push(`Could not save live alert diagnostics: ${error.message}`);
  }
  result.note = args.dryRun
    ? "READ ONLY. No web push sent, no graded results/payment values or delivery logs changed."
    : "Provisional hit alerts only. Official Hit/Miss/Push and payments were not changed.";
  return result;
}
