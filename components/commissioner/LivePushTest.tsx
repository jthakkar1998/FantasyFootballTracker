"use client";
import { useState } from "react";

export function LivePushTest({ phones, production }: { phones: Array<{ id: string; teamName: string }>; production: boolean }) {
  const [id,setId] = useState(phones[0]?.id ?? "");
  const [kind,setKind] = useState<"hit"|"dead">("hit");
  const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [feedback,setFeedback] = useState("");
  async function send() {
    if (!confirmed || !id || busy || !production) return;
    setBusy(true); setFeedback("");
    try {
      const response = await fetch("/api/admin/parlay/test-live-push", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: id, kind, confirmed: true }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || result.message || `HTTP ${response.status}`);
      setFeedback(`${result.message} (HTTP ${result.providerStatus})`);
    } catch (caught) { setFeedback(`Test failed: ${caught instanceof Error ? caught.message : "Unknown error"}`); }
    finally { setBusy(false); setConfirmed(false); }
  }
  return <div className="commissioner-test-tool">
    <p className="parlay-muted">Send a clearly labeled simulated HIT or DEAD notification to exactly one registered device. This does not call the live Cron, settle a wager, change ticket status, or write a notification delivery event.</p>
    {!production ? <p className="notice error">Live device testing is disabled in Preview/local deployments to protect real subscribers.</p> : null}
    <div className="commissioner-test-grid"><label>Registered device
      <select value={id} disabled={!production || busy} onChange={event => setId(event.target.value)}>
        {phones.map((phone,index) => <option value={phone.id} key={phone.id}>{phone.teamName} · device {index+1}</option>)}
      </select></label>
      <label>Test notification
        <select value={kind} disabled={!production || busy} onChange={event => { setKind(event.target.value as "hit"|"dead"); setConfirmed(false); }}>
          <option value="hit">Simulated HIT</option><option value="dead">Simulated DEAD</option>
        </select></label>
    </div>
    <label className="commissioner-test-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!production || busy}/>
      I understand this sends a real TEST notification to one phone, but does not alter the ticket.</label>
    <button type="button" className="button primary" disabled={!confirmed || !id || !production || busy} onClick={() => void send()}>
      {busy ? "Sending test…" : "Send test to selected device"}</button>
    {feedback ? <p role="status" className="parlay-muted">{feedback}</p> : null}
  </div>;
}
