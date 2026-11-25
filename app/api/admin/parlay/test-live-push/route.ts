import { randomUUID } from "node:crypto";
import { isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/supabase";
import { sendWebPush, webPushConfigured, type BrowserPushSubscription } from "@/lib/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An explicit single-device test, not a ticket hit/dead action. Never writes to ticket state or alert delivery tables. */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A Preview can share production Supabase and real phone subscriptions; never send from Preview.
  if (process.env.VERCEL_ENV !== "production")
    return Response.json({ error: "Real-device test pushes are disabled outside Vercel Production." }, { status: 403 });
  if (!webPushConfigured()) return Response.json({ error: "Push is not configured." }, { status: 503 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  let body: { subscriptionId?: unknown; kind?: unknown; confirmed?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof body.subscriptionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.subscriptionId) ||
      !["hit", "dead"].includes(String(body.kind)) || body.confirmed !== true)
    return Response.json({ error: "Select one registered device, a test type and explicitly confirm." }, { status: 400 });
  const { data, error } = await getDb().from("parlay_push_subscriptions").select("id,subscription")
    .eq("id", body.subscriptionId).maybeSingle();
  if (error) return Response.json({ error: "Could not load selected device." }, { status: 500 });
  if (!data) return Response.json({ error: "Registered device not found." }, { status: 404 });
  const kind = body.kind as "hit" | "dead";
  try {
    const status = await sendWebPush(data.subscription as BrowserPushSubscription, {
      title: kind === "hit" ? "TEST ONLY · League parlay HIT" : "TEST ONLY · League ticket DEAD",
      body: kind === "hit" ? "Simulated HIT payload. No player scored; no wager or ticket state changed." :
        "Simulated DEAD payload. The real league ticket is unchanged and all monitoring continues.",
      url: "/parlay", urgent: kind === "dead",
      tag: `ffball-test-${kind}-${randomUUID()}`
    });
    return Response.json({ ok: status >= 200 && status < 300, providerStatus: status,
      message: status >= 200 && status < 300 ? "Push provider accepted the TEST alert. Confirm it appears on the selected phone." :
        "Push provider did not accept the test; inspect the HTTP status." }, { status: status >= 200 && status < 300 ? 200 : 502 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "Test push failed." }, { status: 502 });
  }
}
