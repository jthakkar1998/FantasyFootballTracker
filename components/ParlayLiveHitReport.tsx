"use client";

import { useEffect, useState } from "react";
import type { LiveHitRunResult } from "@/lib/parlay-live-hits";

export function ParlayLiveHitReport({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<LiveHitRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

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
      setCheckedAt(new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check live NFL statistics.");
    } finally { setBusy(false); }
  }

  // An automatic READ-ONLY readiness check makes the page informative before kickoff,
  // while manual refresh remains available. The server short-circuits outside Sunday.
  useEffect(() => { void preview(); /* Run once on page mount. */ }, []);

  return <div className="card grading-preview-card">
    <div className="snapshot-report-header">
      <div>
        <h3>League ticket · live notifications</h3>
        <p className="parlay-muted">Monitors both website and verified off-app legs. Hits are broadcast to all subscribed phones; one verified loss sends the league-wide dead-ticket alert and ends further hits. Monitoring begins 8:15 AM Sunday Central. No official grading or payments are changed.</p>
        <p className="parlay-muted"><strong>League-wide push sending: {enabled ? "Enabled" : "OFF"}</strong>. All 10 teams, opponent starters, NFL games, and pregame lines must be verified before hit alerts can run. Missing live ESPN stats do not block other verified hits.</p>
      </div>
      <button type="button" className="button primary" disabled={busy} onClick={() => void preview()}>
        {busy ? "Checking ticket…" : "Check ticket readiness (read-only)"}
      </button>
    </div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {checkedAt ? <p className="parlay-muted">Last readiness/stat preview: {new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
    }).format(new Date(checkedAt))}. Select Check ticket readiness to refresh.</p> : null}
    {report ? <>
      {report.status === "no_window" || report.status === "empty" ? <p className="grading-preview-status-note" role="status">{report.note}</p> : <>
      <div className="snapshot-summary">
        <span><strong>{report.eligiblePicks}</strong> eligible picks</span>
        <span><strong>{report.verifiedLegs}/{report.eligiblePicks}</strong> selections verified</span>
        <span><strong>{report.currentlyHitting}</strong> currently hitting</span>
        <span><strong>{report.registeredDevices}</strong> league devices</span>
        <span><strong>{report.ticketStatus.replaceAll("_", " ")}</strong> ticket</span>
        <span><strong>{report.unresolved.length}</strong> needs attention</span>
        <span><strong>{report.pendingChecks.length}</strong> pending checks</span>
        <span><strong>0</strong> pushes sent by preview</span>
      </div>
      <div className={`parlay-live-readiness parlay-live-readiness--${report.readiness}`} role="status">
        <strong>{!enabled ? "Push sending is OFF" : report.readiness === "ready" ?
          "All selections verified — ready to monitor" : report.readiness === "pending" ?
          "Verification in progress — not ready yet" : report.readiness === "attention" ?
          "Action needed — hit notifications paused" : report.readiness === "dead" ?
          "League ticket is dead — no more hit alerts" : "Readiness unavailable"}</strong>
        <p>{report.readiness === "ready"
          ? `All ${report.eligiblePicks} wager selections have verified lineup/eligibility evidence, pregame reference lines and NFL game matches. ${report.noBetCount} confirmed no-bet teams. This verifies monitoring prerequisites, not actual push delivery.`
          : report.readiness === "pending"
            ? "A scheduled starter lock or pregame snapshot has not yet been recorded. The page will not mark the ticket ready until these checks complete."
            : report.readiness === "attention"
              ? "One or more selections cannot be verified. Read the issues below before relying on league-wide hit alerts."
              : report.readiness === "dead" ? "A definitive losing leg has closed league-wide hit alerts for this week." : "Check the details below."}</p>
      </div>
      <p className="parlay-muted">{report.note}</p>
      {report.unresolved.length ? <p className="notice error">Selection issues: {report.unresolved.join("; ")}</p> : null}
      {report.pendingChecks.length ? <p className="grading-preview-status-note">Pending pregame checks: {report.pendingChecks.join("; ")}</p> : null}
      {report.liveStatWarnings.length ? <p className="grading-preview-status-note">ESPN live-stat availability (only the affected legs are held for review; other verified hits remain eligible): {report.liveStatWarnings.join("; ")}</p> : null}
      {report.errors.length ? <p className="notice error">ESPN data issues: {report.errors.join("; ")}</p> : null}
      {report.rows.length ? <div className="table-wrap"><table className="snapshot-table grading-preview-table grading-preview-table--live">
        <thead><tr><th>Team / Player</th><th>Sunday FanDuel line</th><th>Pregame checks</th><th>ESPN stat</th><th>Live status</th><th>Explanation</th></tr></thead>
        <tbody>{report.rows.map((row, index) => <tr key={`${row.team}-${index}`}>
          <td><strong>{row.team}</strong><small>{row.player} · {row.source === "offapp" ? "Off-app" : "Website"}</small></td>
          <td>{row.side.toUpperCase()} {row.line ?? ""}<small>{row.statId.replaceAll("_", " ")}</small></td>
          <td><span className={`grading-grade-pill ${row.readiness === "verified" ? "ready" : row.readiness === "pending" ? "settled" : "review"}`}>{row.readiness === "verified" ? "Verified" : row.readiness === "pending" ? "Pending" : "Attention"}</span><small>{row.readinessReason}</small></td>
          <td>{row.actualValue ?? "—"}<small>{row.gameFinal ? "Final" : row.gameStarted ? "In-game / not final" : "Pre-game"}</small></td>
          <td><span className={`grading-grade-pill ${row.status === "hit" ? "ready" : row.status === "review" || row.status === "miss" ? "review" : "settled"}`}>{row.status === "hit" ? "HITTING" : row.status === "miss" ? "MISSED" : row.status === "waiting" ? "Waiting" : "Review"}</span></td>
          <td><small>{row.reason}</small></td>
        </tr>)}</tbody>
      </table></div> : null}
      </>}
      <p className="parlay-muted grading-preview-note">Dry-run never sends a push or edits grades, payments, previous weeks, or delivery history. Outside the live window, the endpoint responds but does not check ESPN or registered devices.</p>
    </> : null}
  </div>;
}
