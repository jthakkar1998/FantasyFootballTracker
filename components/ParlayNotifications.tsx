"use client";

import { useEffect, useState } from "react";

function decodedPublicKey(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function ParlayNotifications({ teamId, publicKey }: { teamId: number; publicKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => { setEnabled(false); setMessage(null); }, [teamId]);

  // Avoid server/client hydration differences; browser features are detected after mount.
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }, []);

  async function enable() {
    if (!publicKey || !supported) return;
    setBusy(true);
    setMessage(null);
    try {
      // Ask directly from the click gesture (required by iOS Home Screen apps).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were blocked. Allow them in your phone's notification settings.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodedPublicKey(publicKey)
      });
      const response = await fetch("/api/parlay/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, subscription: subscription.toJSON() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not register notifications.");
      setEnabled(true);
      setMessage("Reminders enabled for this team on this device. You'll only get them when your pick is missing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        await fetch("/api/parlay/notifications", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setMessage("Notifications disabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable notifications.");
    } finally { setBusy(false); }
  }

  return (
    <div className="parlay-notify-panel">
      <strong>🔔 Missing-pick reminders</strong>
      <p>Get reminders Thu–Sat at 8 PM and Sunday at 9 AM and 11:30 AM Central, only if you haven&apos;t submitted.</p>
      {!publicKey ? <small>Commissioner setup needed to enable notifications.</small> : !supported ? (
        <small>On iPhone, open in Safari, tap Share → Add to Home Screen, then open the installed app to enable notifications. Notifications need a supported browser and HTTPS.</small>
      ) : (
        <div className="notify-actions">
          <button type="button" className="button small" disabled={busy} onClick={enable}>{busy ? "Working…" : enabled ? "Update notification team" : "Enable phone reminders"}</button>
          <button type="button" className="button ghost" disabled={busy} onClick={disable}>Disable on this device</button>
        </div>
      )}
      {message ? <p role="status" className="notify-feedback">{message}</p> : null}
    </div>
  );
}
