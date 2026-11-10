"use client";

import { useState } from "react";
import type { GradeDecision } from "@/lib/parlay-grade-core";
import type { GradingPreview } from "@/lib/parlay-auto-grade";

function formatLine(row: GradeDecision): string {
  const side = row.side.charAt(0).toUpperCase() + row.side.slice(1);
  return row.line === null ? side : `${side} ${row.line}`;
}

export function ParlayGradingReport({ currentWeek, snapshotWeeks, writesEnabled, minWeek = 9 }: {
  currentWeek: number; snapshotWeeks: number[]; writesEnabled: boolean; minWeek?: number;
}) {
  const weeks = [...new Set(snapshotWeeks.filter(w => w >= minWeek && w <= currentWeek))].sort((a, b) => b - a);
  const [week, setWeek] = useState(weeks[0] ?? Math.max(minWeek, currentWeek - 1));
  const [result, setResult] = useState<GradingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [appliedMessage, setAppliedMessage] = useState("");

  async function preview() {
    if (busy) return;
    setBusy(true); setError(""); setAppliedMessage(""); setResult(null);
    try {
      const response = await fetch(`/api/admin/parlay/grading-preview?week=${week}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? `Preview failed (HTTP ${response.status})`);
      setResult(data as GradingPreview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load grading preview.");
    } finally { setBusy(false); }
  }

  async function applyVerified() {
    if (busy || !writesEnabled || !result || result.ready < 1) return;
    if (!window.confirm(`Apply ${result.ready} eligible, verified auto-grade(s) for Week ${week}?\n\nOnly pending, non-manual website picks with valid primary lines will change. Payment records and off-app bets are never changed. Click Cancel if you haven't verified the preview against final NFL stats.`)) return;
    setBusy(true); setError(""); setAppliedMessage("");
    try {
      const response = await fetch("/api/admin/parlay/grading-apply", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, confirmation: `APPLY_WEEK_${week}` })
      });
      const data = await response.json() as GradingPreview & { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? `Apply failed (HTTP ${response.status})`);
      setResult(data);
      setAppliedMessage(`${data.applied} website pick(s) were graded. Refresh the Commissioner page to see the updated official results. ${data.review} still need manual review.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not apply grades.");
    } finally { setBusy(false); }
  }

  return <div className="card grading-preview-card">
    <div className="snapshot-report-header">
      <div>
        <h3>Phase 2 · Automatic grading preview</h3>
        <p className="parlay-muted">Compare FINAL ESPN NFL box scores with Sunday's saved <strong>11:56 AM FanDuel lines</strong>. Preview never edits bets, payments, or prior weeks.</p>
      </div>
      <div className="grading-preview-controls">
        <label className="snapshot-week-select">Week
          <select aria-label="Grading preview week" value={week} onChange={event => { setWeek(Number(event.target.value)); setResult(null); setError(""); }}>
            {weeks.length ? weeks.map(w => <option key={w} value={w}>Week {w}</option>) : <option value={week}>Week {week}</option>}
          </select>
        </label>
        <button className="button primary" type="button" onClick={() => void preview()} disabled={busy || !weeks.length}>
          {busy ? "Checking NFL results…" : "Preview grades (read-only)"}
        </button>
      </div>
    </div>
    {!weeks.length ? <p className="parlay-muted">No captured Sunday snapshots are available to grade yet.</p> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {appliedMessage ? <p className="notice success" role="status">{appliedMessage}</p> : null}
    {result ? <>
      <div className="snapshot-summary">
        <span><strong>{result.total}</strong> website picks</span>
        <span><strong>{result.ready}</strong> ready to auto-grade</span>
        <span><strong>{result.review}</strong> need review</span>
        <span><strong>{result.alreadyGraded}</strong> already graded / commissioner-controlled</span>
      </div>
      <p className="parlay-muted">{result.note}</p>
      {result.errors.length ? <p className="notice error">Provider errors: {result.errors.join("; ")}</p> : null}
      <div className="table-wrap">
        <table className="snapshot-table grading-preview-table">
          <thead><tr><th>Team / Player</th><th>Prop</th><th>Locked FanDuel line</th><th>Final NFL stat</th><th>Proposed result</th><th>Explanation</th></tr></thead>
          <tbody>{result.decisions.length ? result.decisions.map(row => <tr key={row.submissionId}>
            <td><strong>{row.team}</strong><small>{row.player}</small></td>
            <td>{row.statId.replaceAll("_", " ")}</td>
            <td>{formatLine(row)}<small>{row.source === "primary" ? "11:56 primary" : row.source === "backup" ? "11:45 backup · review only" : "Missing"}</small></td>
            <td>{row.actualValue === null ? "—" : row.actualValue}</td>
            <td><span className={`grading-grade-pill ${row.status === "review" ? "review" : row.status === "already_graded" ? "settled" : "ready"}`}>
              {row.status === "ready" ? row.predictedResult?.toUpperCase() ?? "—" : row.status === "already_graded" ? "Manual / settled" : "Review"}
            </span></td>
            <td><small>{row.reason}</small></td>
          </tr>) : <tr><td colSpan={6}>No website picks for this week.</td></tr>}</tbody>
        </table>
      </div>
      <div className="grading-approval-actions">
        {writesEnabled && result.ready > 0 && result.status === "preview" ? <button className="button primary" type="button" disabled={busy} onClick={() => void applyVerified()}>
          {busy ? "Applying verified grades…" : `Apply ${result.ready} verified grades for Week ${week}`}
        </button> : <span className="parlay-muted">{writesEnabled ? "No ungraded, auto-settleable results to apply." : "Automatic writes are currently OFF. Verify the preview first; enable the Vercel flag only after review."}</span>}
      </div>
      <p className="parlay-muted grading-preview-note">Anytime-TD misses, missing athlete statistics, DNP/void scenarios, backup-only snapshots, and eligibility failures remain commissioner review items. A preview never performs writes. Enabling scheduled writes is a separate production deployment step.</p>
    </> : null}
  </div>;
}
