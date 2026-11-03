import { getCurrentParlayContext } from "./parlay";
import { listParlaySubmissions } from "./parlay-db";
import { reminderCopy, reminderForInstant } from "./parlay-reminders";
import { getDb } from "./supabase";
import { sendWebPush, webPushConfigured, type BrowserPushSubscription } from "./web-push";

export interface StoredPushSubscription {
  id: string;
  team_id: number;
  endpoint: string;
  subscription: BrowserPushSubscription;
}

export async function registerParlayPushSubscription(teamId: number, value: BrowserPushSubscription): Promise<void> {
  const { error } = await getDb().from("parlay_push_subscriptions").upsert({
    team_id: teamId,
    endpoint: value.endpoint,
    subscription: value,
    updated_at: new Date().toISOString()
  }, { onConflict: "endpoint" });
  if (error) throw new Error(`Could not register device: ${error.message}`);
}

export async function unregisterParlayPushSubscription(endpoint: string): Promise<void> {
  const { error } = await getDb().from("parlay_push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(`Could not unregister device: ${error.message}`);
}

export async function notificationRegistrationCounts(): Promise<Map<number, number>> {
  const { data, error } = await getDb().from("parlay_push_subscriptions").select("team_id");
  if (error) throw new Error(`Could not load device counts: ${error.message}`);
  const counts = new Map<number, number>();
  for (const row of data ?? []) {
    const team = Number(row.team_id);
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  return counts;
}

export async function runParlayReminders(nowIso = new Date().toISOString(), options: { dryRun?: boolean } = {}) {
  if (!webPushConfigured()) throw new Error("Web Push VAPID keys are not configured.");
  const context = await getCurrentParlayContext();
  const reminder = reminderForInstant(nowIso, context.sundayDate);
  if (!options.dryRun && (!reminder || new Date(nowIso).getTime() >= new Date(context.deadlineAt).getTime())) {
    return { slot: null, missingTeams: 0, registeredDevices: 0, eligibleDevices: 0, attempted: 0, retried: 0, sent: 0, skipped: 0, failed: 0, reason: "Not in a reminder window or past the deadline." };
  }
  const [picks, outsideResponse, subscriptionResponse] = await Promise.all([
    listParlaySubmissions(context.season, context.week),
    getDb().from("parlay_weekly_team_tracking").select("team_id")
      .eq("season", context.season).eq("week", context.week)
      .eq("submitted_outside_app", true),
    getDb().from("parlay_push_subscriptions").select("id,team_id,endpoint,subscription")
  ]);
  if (outsideResponse.error) throw new Error(`Could not check off-app picks: ${outsideResponse.error.message}`);
  if (subscriptionResponse.error) throw new Error(`Could not fetch push registrations: ${subscriptionResponse.error.message}`);
  // If the commissioner has already recorded a texted-in pick, no reminder is needed.
  const alreadySubmitted = new Set([
    ...picks.map(pick => pick.team_id),
    ...(outsideResponse.data ?? []).map(row => Number(row.team_id))
  ]);
  const missingTeams = new Map(context.teams.filter(team => !alreadySubmitted.has(team.teamId)).map(team => [team.teamId, team.teamName]));
  // A dry run is read-only: it exercises eligibility and subscription lookup
  // without claiming any delivery, touching payment data, or sending pushes.
  if (options.dryRun) return {
    slot: reminder?.slot ?? null, dryRun: true, missingTeams: missingTeams.size,
    registeredDevices: (subscriptionResponse.data ?? []).length,
    eligibleDevices: ((subscriptionResponse.data ?? []) as StoredPushSubscription[])
      .filter(subscription => missingTeams.has(subscription.team_id)).length,
    attempted: 0, retried: 0, sent: 0, skipped: 0, failed: 0
  };
  // An atomic Postgres claim prevents duplicate sends across overlapping cron runs.
  // Failed pushes can be retried (at most 3 total attempts); successful pushes
  // never repeat in the same week/slot. See the Supabase Cron migration.
  const registeredDevices = (subscriptionResponse.data ?? []).length;
  const eligibleDevices = ((subscriptionResponse.data ?? []) as StoredPushSubscription[])
    .filter(subscription => missingTeams.has(subscription.team_id)).length;
  const outcomes = await Promise.all(((subscriptionResponse.data ?? []) as StoredPushSubscription[]).map(async (subscription) => {
    const teamName = missingTeams.get(subscription.team_id);
    if (!teamName) return { status: "skipped" as const, retried: false };
    const { data: claims, error: claimError } = await getDb().rpc("claim_parlay_reminder_delivery", {
      p_season: context.season, p_week: context.week, p_team_id: subscription.team_id,
      p_subscription_id: subscription.id, p_slot: reminder.slot
    });
    if (claimError) throw new Error(`Could not claim reminder delivery: ${claimError.message}`);
    const claim = (claims as { delivery_id: string; attempts: number }[] | null)?.[0];
    if (!claim) return { status: "skipped" as const, retried: false };
    const retried = claim.attempts > 1;
    let status: "sent" | "failed" | "expired" = "failed";
    let httpStatus: number | null = null;
    let lastError: string | null = null;
    try {
      const copy = reminderCopy(reminder.slot, teamName);
      const code = await sendWebPush(subscription.subscription, { ...copy, url: "/parlay", urgent: reminder.urgent });
      httpStatus = code;
      if (code >= 200 && code < 300) status = "sent";
      else if (code === 404 || code === 410) status = "expired";
      else lastError = `Push service returned HTTP ${code}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : "Push delivery failed.";
    }
    const { error: updateError } = await getDb().from("parlay_reminder_deliveries").update({
      status, sent_at: status === "sent" ? new Date().toISOString() : null,
      last_http_status: httpStatus, last_error: lastError
    }).eq("id", claim.delivery_id);
    if (updateError) throw new Error(`Could not record reminder delivery: ${updateError.message}`);
    if (status === "expired") await unregisterParlayPushSubscription(subscription.endpoint);
    return { status: status === "sent" ? "sent" as const : "failed" as const, retried };
  }));
  const sent = outcomes.filter(outcome => outcome.status === "sent").length;
  const skipped = outcomes.filter(outcome => outcome.status === "skipped").length;
  const failed = outcomes.filter(outcome => outcome.status === "failed").length;
  const retried = outcomes.filter(outcome => outcome.retried).length;
  return { slot: reminder.slot, missingTeams: missingTeams.size, registeredDevices, eligibleDevices,
    attempted: sent + failed, retried, sent, skipped, failed };
}
