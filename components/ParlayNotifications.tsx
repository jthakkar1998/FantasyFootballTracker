"use client";

import { useEffect, useState } from "react";

type RegistrationStatus = "checking" | "enabled" | "other-team" | "not-registered" | "not-subscribed" | "error";

function decodedPublicKey(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function subscriptionTeam(subscription: PushSubscription): Promise<number | null> {
  const response = await fetch("/api/parlay/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action: "status", subscription: subscription.toJSON() })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Couldn't check saved notifications.");
  return Number.isInteger(result.registeredTeamId) ? result.registeredTeamId : null;
}

function keyMatches(subscription: PushSubscription, publicKey: string): boolean {
  const existingKey = subscription.options?.applicationServerKey;
  if (!existingKey) return true;
  const expected = decodedPublicKey(publicKey);
  const actual = new Uint8Array(existingKey);
  return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}

export function ParlayNotifications({ teamId, publicKey }: { teamId: number; publicKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<RegistrationStatus>("checking");
  const [registeredTeam, setRegisteredTeam] = useState<number | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const browserSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(browserSupported);
    setStatus("checking");
    setRegisteredTeam(null);
    setMessage(null);

    async function checkSavedStatus() {
      if (!browserSupported || !publicKey || Notification.permission !== "granted") {
        if (!cancelled) setStatus("not-subscribed");
        return;
      }
      try {
        const subscription = await existingSubscription();
        if (cancelled) return;
        if (!subscription) { setStatus("not-subscribed"); return; }
        if (!keyMatches(subscription, publicKey)) {
          setStatus("not-registered");
          setMessage("Your device has an older notification key. Select Enable to reconnect it.");
          return;
        }
        const savedTeam = await subscriptionTeam(subscription);
        if (cancelled) return;
        setRegisteredTeam(savedTeam);
        setStatus(savedTeam === teamId ? "enabled" : savedTeam === null ? "not-registered" : "other-team");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Could not check device notification status.");
        }
      }
    }
    void checkSavedStatus();
    return () => { cancelled = true; };
  }, [teamId, publicKey]);

  async function enable() {
    if (!publicKey || !supported) return;
    setBusy(true);
    setMessage(null);
    try {
      // Permission and subscribe() must stay inside the user's click gesture.
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were blocked. Allow them in your phone's notification settings.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !keyMatches(subscription, publicKey)) {
        // An old VAPID key cannot receive notifications signed with the new key.
        const removal = await fetch("/api/parlay/notifications", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        if (!removal.ok) throw new Error("Could not remove the old push subscription. Please try again.");
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription = subscription ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodedPublicKey(publicKey)
      });
      const response = await fetch("/api/parlay/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", teamId, subscription: subscription.toJSON() })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not save device registration.");
      setStatus("enabled");
      setRegisteredTeam(teamId);
      setMessage("Reminders enabled for this team on this device. You'll only get them when your pick is missing.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await existingSubscription();
      if (subscription) {
        const response = await fetch("/api/parlay/notifications", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        if (!response.ok) throw new Error("Could not remove the saved device registration.");
        await subscription.unsubscribe();
      }
      setStatus("not-subscribed");
      setRegisteredTeam(null);
      setMessage("Notifications disabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable notifications.");
    } finally { setBusy(false); }
  }

  const enabled = status === "enabled";
  const actionText = status === "checking" ? "Checking device…" :
    enabled ? "Enabled on this device" : status === "other-team" ? "Switch notifications to this team" :
    status === "not-registered" ? "Reconnect phone reminders" : "Enable phone reminders";

  return (
    <div className="parlay-notify-panel">
      <strong>🔔 Missing-pick reminders</strong>
      <p>Get reminders Thu–Sat at 8 PM and Sunday at 9 AM and 11:30 AM Central, only if you haven&apos;t submitted.</p>
      {!publicKey ? <small>Commissioner setup needed to enable notifications.</small> : !supported ? (
        <small>On iPhone, open in Safari, tap Share → Add to Home Screen, then open the installed app to enable notifications. Notifications need a supported browser and HTTPS.</small>
      ) : (
        <div className="notify-actions">
          <button type="button" className="button small" disabled={busy || enabled || status === "checking"} onClick={enable}>
            {busy ? "Working…" : actionText}
          </button>
          {status === "other-team" ? <small>This device is currently linked to team ID {registeredTeam}. You can switch it here.</small> : null}
          {enabled ? <small>✓ Registered for this fantasy team. No need to enable again each week.</small> : null}
          {(enabled || status === "other-team") ? <button type="button" className="button ghost" disabled={busy} onClick={disable}>Disable on this device</button> : null}
        </div>
      )}
      {message ? <p role="status" className="notify-feedback">{message}</p> : null}
    </div>
  );
}
