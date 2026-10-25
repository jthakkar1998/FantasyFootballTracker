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

export async function runParlayReminders(nowIso = new Date().toISOString()) {
  if (!webPushConfigured()) throw new Error("Web Push VAPID keys are not configured.");
  const context = await getCurrentParlayContext();
  const reminder = reminderForInstant(nowIso, context.sundayDate);
  if (!reminder || Date.now() >= new Date(context.deadlineAt).getTime()) {
    return { slot: null, sent: 0, skipped: 0, failed: 0, reason: "Not in a reminder window or past the deadline." };
  }
  const [picks, subscriptionResponse] = await Promise.all([
    listParlaySubmissions(context.season, context.week),
    getDb().from("parlay_push_subscriptions").select("id,team_id,endpoint,subscription")
  ]);
  if (subscriptionResponse.error) throw new Error(`Could not fetch push registrations: ${subscriptionResponse.error.message}`);
  const alreadySubmitted = new Set(picks.map(pick => pick.team_id));
  const missingTeams = new Map(context.teams.filter(team => !alreadySubmitted.has(team.teamId)).map(team => [team.teamId, team.teamName]));
  // Concurrent sends bound the execution time so a slow push provider does not
  // block a small league's entire reminder run on Vercel.
  const outcomes = await Promise.all(((subscriptionResponse.data ?? []) as StoredPushSubscription[]).map(async (subscription) => {
    const teamName = missingTeams.get(subscription.team_id);
    if (!teamName) return "skipped" as const;
    // Claim each delivery before sending so simultaneous jobs cannot duplicate it.
    const { data: claim, error: claimError } = await getDb().from("parlay_reminder_deliveries").insert({
      season: context.season, week: context.week, team_id: subscription.team_id,
      subscription_id: subscription.id, reminder_slot: reminder.slot
    }).select("id").single();
    if (claimError?.code === "23505") return "skipped" as const;
    if (claimError || !claim) throw new Error(`Could not claim reminder delivery: ${claimError?.message ?? "Unknown error"}`);
    let status = "failed";
    try {
      const copy = reminderCopy(reminder.slot, teamName);
      const code = await sendWebPush(subscription.subscription, { ...copy, url: "/parlay", urgent: reminder.urgent });
      if (code >= 200 && code < 300) status = "sent";
      else if (code === 404 || code === 410) status = "expired";
    } catch { /* An unreachable phone shouldn't prevent other members' notifications. */ }
    const { error: updateError } = await getDb().from("parlay_reminder_deliveries").update({
      status, sent_at: status === "sent" ? new Date().toISOString() : null
    }).eq("id", claim.id);
    if (updateError) throw new Error(`Could not record reminder delivery: ${updateError.message}`);
    if (status === "expired") await unregisterParlayPushSubscription(subscription.endpoint);
    return status === "sent" ? "sent" as const : "failed" as const;
  }));
  const sent = outcomes.filter(status => status === "sent").length;
  const skipped = outcomes.filter(status => status === "skipped").length;
  const failed = outcomes.filter(status => status === "failed").length;
  return { slot: reminder.slot, missingTeams: missingTeams.size, sent, skipped, failed };
}
