"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function HomePaymentQuickAction({ season, week, teamId, enabled }: { season: number; week: number; teamId: number; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function markPaid() {
    if (busy || !enabled) return;
    setBusy(true); setError("");
    try {
      // Use the SAME commissioner bulk API used by the full Parlay table.
      const response = await fetch("/api/admin/parlay/bulk", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [{ season, week, teamId, paymentReceived: true }] }) });
      const data = await response.json();
      if (!response.ok || data.failed?.length || data.saved?.length !== 1)
        throw new Error(data.failed?.[0]?.message ?? data.error ?? "Payment was not confirmed by the server.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save payment."); }
    finally { setBusy(false); }
  }
  return <span className="commissioner-quick-control">
    <button className="button small" type="button" disabled={busy || !enabled} onClick={() => void markPaid()}>
      {busy ? "Saving…" : "Mark paid"}</button>
    {error ? <small className="commissioner-inline-error" role="alert">{error}</small> : null}
  </span>;
}
