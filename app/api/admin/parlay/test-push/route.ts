import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/supabase";
import { sendWebPush, webPushConfigured, type BrowserPushSubscription } from "@/lib/web-push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const form = await request.formData();
  const teamId = Number(form.get("teamId"));
  if (!Number.isInteger(teamId) || !webPushConfigured()) return new Response("Invalid team or Web Push not configured.", { status: 400 });
  const { data, error } = await getDb().from("parlay_push_subscriptions").select("subscription").eq("team_id", teamId).limit(10);
  if (error) return new Response(`Could not load registered phones: ${error.message}`, { status: 500 });
  if (!data?.length) return new Response("No phones registered for this team.", { status: 404 });
  const statuses = await Promise.all(data.map(async (item) => {
    try {
      return await sendWebPush(item.subscription as BrowserPushSubscription, {
        title: "Fantasy Parlay: Test notification",
        body: "Your phone is registered for missing-pick reminders. No action needed.",
        url: "/parlay",
        urgent: false
      });
    } catch { return 0; }
  }));
  const successes = statuses.filter(code => code >= 200 && code < 300).length;
  const destination = new URL(`/admin?testPush=${successes}-${statuses.length}#parlay-management`, request.url);
  return NextResponse.redirect(destination, 303);
}
