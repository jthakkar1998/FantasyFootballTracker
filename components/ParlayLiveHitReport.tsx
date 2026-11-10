"use client";

import { useState } from "react";
import type { LiveHitRunResult } from "@/lib/parlay-live-hits";

export function ParlayLiveHitReport({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<LiveHitRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function preview() {
    if (busy) return;
    setBusy(true); setReport(null); setError("");
    try {
      const response = await fetch("/api/admin/parlay/live-hit-preview", {
        credentials: "same-origin", cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setReport(data as LiveHitRunResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check live NFL statistics.");
    } finally { setBusy(false); }
  }

  return <div className="card grading-preview-card">
    <div className="snapshot-report-header">
      <div>
        <h3>Phase 2 · Live hit notifications</h3>
        <p className="parlay-muted">Checks only your league&apos;s current Sunday picks every 3 minutes while games are underway. Over/Yes can alert live; Under/No only after final NFL stats. These alerts are <strong>provisional</strong> and never grade or change a bet.</p>
        <p className="parlay-muted"><strong>Push sending: {enabled ? "Enabled (live schedule required)" : "OFF"}</strong>. Each registered phone gets at most one accepted push per matching pick.</p>
      </div>
      <button type="button" className="button primary" disabled={busy} onClick={() => void preview()}>
        {busy ? "Checking live stats…" : "Preview live alerts (read-only)"}
      </button>
    </div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {report ? <>
      {report.status === "no_window" || report.status === "empty" ? <p className="grading-preview-status-note" role="status">{report.note}</p> : <>
      <div className="snapshot-summary">
        <span><strong>{report.eligiblePicks}</strong> eligible picks</span>
        <span><strong>{report.currentlyHitting}</strong> currently hitting</span>
        <span><strong>{report.registeredDevices}</strong> league devices</span>
        <span><strong>0</strong> pushes sent by preview</span>
      </div>
      <p className="parlay-muted">{report.note}</p>
      {report.errors.length ? <p className="notice error">ESPN data issues: {report.errors.join("; ")}</p> : null}
      {report.rows.length ? <div className="table-wrap"><table className="snapshot-table grading-preview-table grading-preview-table--live">
        <thead><tr><th>Team / Player</th><th>Sunday FanDuel line</th><th>ESPN stat</th><th>Live status</th><th>Explanation</th></tr></thead>
        <tbody>{report.rows.map((row, index) => <tr key={`${row.team}-${index}`}>
          <td><strong>{row.team}</strong><small>{row.player}</small></td>
          <td>{row.side.toUpperCase()} {row.line ?? ""}<small>{row.statId.replaceAll("_", " ")}</small></td>
          <td>{row.actualValue ?? "—"}<small>{row.gameFinal ? "Final" : "In-game / not yet final"}</small></td>
          <td><span className={`grading-grade-pill ${row.status === "hit" ? "ready" : row.status === "review" ? "review" : "settled"}`}>{row.status === "hit" ? "HITTING" : row.status === "waiting" ? "Waiting" : "Review"}</span></td>
          <td><small>{row.reason}</small></td>
        </tr>)}</tbody>
      </table></div> : null}
      </>}
      <p className="parlay-muted grading-preview-note">Dry-run never sends a push or edits grades, payments, previous weeks, or delivery history. Outside the live window, the endpoint responds but does not check ESPN or registered devices.</p>
    </> : null}
  </div>;
}
