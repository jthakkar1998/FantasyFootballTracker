import { getCurrentParlayContext, getTeamContext } from "@/lib/parlay";
import { registerParlayPushSubscription, unregisterParlayPushSubscription } from "@/lib/parlay-notifications";
import { getDb } from "@/lib/supabase";
import { validatePushSubscription, webPushConfigured } from "@/lib/web-push";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  return Boolean(host) && new URL(origin).host === host;
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
    if (!webPushConfigured()) return Response.json({ ok: false, error: "Notifications are not configured yet." }, { status: 503 });
    const body = await request.json() as { action?: string; teamId?: number; subscription?: unknown };
    const subscription = validatePushSubscription(body.subscription);

    // A read-only subscription check. This lets a returning device show its real
    // status without asking for permission again or silently reassigning a team.
    // The endpoint is a bearer capability known to this device; don't put it in a URL.
    if (body.action === "status") {
      const { data, error } = await getDb().from("parlay_push_subscriptions")
        .select("team_id").eq("endpoint", subscription.endpoint).maybeSingle();
      if (error) throw new Error(`Could not check device registration: ${error.message}`);
      return Response.json({ ok: true, registeredTeamId: data ? Number(data.team_id) : null });
    }
    if (body.action !== undefined && body.action !== "register") {
      return Response.json({ ok: false, error: "Invalid action." }, { status: 400 });
    }

    const teamId = Number(body.teamId);
    if (!Number.isInteger(teamId)) return Response.json({ ok: false, error: "Select your fantasy team." }, { status: 400 });
    getTeamContext(await getCurrentParlayContext(), teamId);
    await registerParlayPushSubscription(teamId, subscription);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not register." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
    const body = await request.json() as { subscription?: unknown };
    const subscription = validatePushSubscription(body.subscription);
    await unregisterParlayPushSubscription(subscription.endpoint);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not unregister." }, { status: 400 });
  }
}
