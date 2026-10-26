"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParlayCommissionerRow } from "@/lib/parlay-admin";
import {
  diffBet, exportBetsCsv, importBetsCsv, initialBet, results, rowKey,
  type BetUpdate, type EditableBet, type BetResult
} from "@/lib/parlay-bulk";

type SaveStatus = "saved" | "error";
type SaveResponse = { saved?: string[]; failed?: { key: string; message: string }[]; error?: string };

function makeStartingDrafts(rows: ParlayCommissionerRow[]): Record<string, EditableBet> {
  return Object.fromEntries(rows.map(row => [rowKey(row.season, row.week, row.teamId), initialBet(row)]));
}

export function CommissionerParlayManager({ rows, season }: { rows: ParlayCommissionerRow[]; season: number }) {
  const [baseline, setBaseline] = useState<Record<string, EditableBet>>(() => makeStartingDrafts(rows));
  const [drafts, setDrafts] = useState<Record<string, EditableBet>>(() => makeStartingDrafts(rows));
  const [saveStates, setSaveStates] = useState<Record<string, SaveStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [weekFilter, setWeekFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const weekNumbers = useMemo(() => [...new Set(rows.map(row => row.week))].sort((a, b) => a - b), [rows]);
  const pending = useMemo(() => rows.flatMap(row => {
    const key = rowKey(row.season, row.week, row.teamId);
    const difference = diffBet(row, baseline[key], drafts[key]);
    return difference ? [difference] : [];
  }), [rows, baseline, drafts]);
  const pendingKeys = new Set(pending.map(row => rowKey(row.season, row.week, row.teamId)));
  const visibleRows = rows.filter(row =>
    (weekFilter === "all" || row.week === Number(weekFilter)) &&
    row.teamName.toLowerCase().includes(teamFilter.trim().toLowerCase())
  );
  const unsavedCount = pending.length;
  useEffect(() => {
    if (!unsavedCount) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [unsavedCount]);

  const unverified = rows.filter(row => {
    const entry = drafts[rowKey(row.season, row.week, row.teamId)];
    return (row.hasWebsitePick || entry.source === "outside") && !entry.paid;
  }).length;

  function edit(key: string, patch: Partial<EditableBet>) {
    setDrafts(previous => ({ ...previous, [key]: { ...previous[key], ...patch } }));
    setSaveStates(previous => { const next = { ...previous }; delete next[key]; return next; });
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
    setMessage("");
  }

  async function save(updates: BetUpdate[]) {
    if (!updates.length || busy) return;
    const snapshot = { ...drafts };
    setBusy(true);
    setMessage("");
    let successes = 0;
    let failures = 0;
    // Short batches keep request duration predictable for Vercel.
    for (let offset = 0; offset < updates.length; offset += 25) {
      const batch = updates.slice(offset, offset + 25);
      try {
        const response = await fetch("/api/admin/parlay/bulk", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: batch })
        });
        const data = await response.json() as SaveResponse;
        if (!response.ok && response.status !== 207) throw new Error(data.error || `HTTP ${response.status}`);
        const saved = data.saved ?? [];
        const failed = data.failed ?? [];
        const savedSet = new Set(saved);
        setBaseline(previous => {
          const next = { ...previous };
          for (const key of saved) if (snapshot[key]) next[key] = snapshot[key];
          return next;
        });
        setSaveStates(previous => {
          const next = { ...previous };
          for (const key of saved) next[key] = "saved";
          for (const item of failed) next[item.key] = "error";
          return next;
        });
        setErrors(previous => {
          const next = { ...previous };
          for (const key of saved) delete next[key];
          for (const item of failed) next[item.key] = item.message;
          return next;
        });
        successes += saved.length;
        failures += failed.length;
        // Fail closed if the server omits any row from its report.
        for (const row of batch) {
          const key = rowKey(row.season, row.week, row.teamId);
          if (!savedSet.has(key) && !failed.some(item => item.key === key)) {
            failures++;
            setErrors(previous => ({ ...previous, [key]: "Server did not confirm the save." }));
            setSaveStates(previous => ({ ...previous, [key]: "error" }));
          }
        }
      } catch (error) {
        failures += batch.length;
        const reason = error instanceof Error ? error.message : "Network error.";
        setSaveStates(previous => ({ ...previous, ...Object.fromEntries(batch.map(row => [rowKey(row.season, row.week, row.teamId), "error" as SaveStatus])) }));
        setErrors(previous => ({ ...previous, ...Object.fromEntries(batch.map(row => [rowKey(row.season, row.week, row.teamId), reason])) }));
      }
    }
    setMessage(failures ? `${successes} row(s) saved; ${failures} failed. Failed rows remain editable and unsaved.` : `✓ Saved ${successes} row(s). You can edit and save again anytime.`);
    setBusy(false);
  }

  function downloadCsv() {
    const csv = exportBetsCsv(rows, drafts);
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `parlay-commissioner-${season}-template.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function readUpload(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("CSV file is too large (1 MB maximum).");
      const text = await file.text();
      const next = importBetsCsv(text, rows, drafts);
      setDrafts(next);
      setSaveStates({});
      setErrors({});
      const count = rows.filter(row => {
        const key = rowKey(row.season, row.week, row.teamId);
        return diffBet(row, baseline[key], next[key]) !== null;
      }).length;
      setMessage(`CSV imported and checked. ${count} row(s) have unsaved changes. Review them, then click Save all changes. Nothing has been uploaded to Supabase yet.`);
    } catch (error) {
      setMessage(`CSV not imported: ${error instanceof Error ? error.message : "Invalid file."} No changes were applied.`);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="commissioner-bulk">
      <div className="commissioner-bulk-toolbar card">
        <div className="commissioner-bulk-filters">
          <label>Week
            <select value={weekFilter} onChange={event => setWeekFilter(event.target.value)} aria-label="Filter commissioner bets by week">
              <option value="all">All weeks</option>
              {weekNumbers.map(week => <option key={week} value={week}>Week {week}</option>)}
            </select>
          </label>
          <label>Team
            <input value={teamFilter} onChange={event => setTeamFilter(event.target.value)} placeholder="Find a team..." aria-label="Filter by team name"/>
          </label>
        </div>
        <div className="commissioner-bulk-actions">
          <span className="count-chip">{unverified} unverified $1 payments{unsavedCount ? " (incl. pending edits)" : ""}</span>
          <button className="button ghost" type="button" onClick={downloadCsv} disabled={busy}>Download CSV template</button>
          <input ref={fileInput} className="commissioner-csv-input" type="file" accept=".csv,text/csv" aria-label="Import commissioner bets CSV" onChange={event => void readUpload(event.target.files?.[0])}/>
          <button className="button ghost" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Import filled CSV</button>
          <button className="button primary" type="button" onClick={() => void save(pending)} disabled={busy || !unsavedCount}>
            {busy ? "Saving..." : `Save all changes (${unsavedCount})`}
          </button>
        </div>
      </div>
      <p className="commissioner-bulk-instructions">Edit several rows or weeks without refreshing. <strong>Save all changes</strong> when ready. For Excel: download the CSV, fill in <code>source</code> (outside/none/website), <code>bet_details</code>, <code>result</code> (hit/miss/push/void/pending), and <code>payment_received</code> (yes/no), then import it here and save. The CSV uses team IDs so identical team names are not confused. Website picks cannot be replaced by CSV.</p>
      <div className={`commissioner-save-banner ${message.startsWith("CSV not imported") || message.includes("failed") ? "is-error" : ""}`} role="status" aria-live="polite">
        {message || (unsavedCount ? `${unsavedCount} row(s) have unsaved changes.` : "All displayed changes are up to date. Saved rows turn green.")}
      </div>
      <div className="table-wrap card admin-table parlay-commissioner-table commissioner-bulk-table-wrap">
        <table className="commissioner-bulk-table">
          <colgroup><col className="week-col"/><col className="team-col"/><col className="bet-col"/><col className="result-col"/><col className="source-col"/><col className="member-col"/><col className="payment-col"/><col className="save-col"/></colgroup>
          <thead><tr><th>Week</th><th>Team / member</th><th>Bet</th><th>Result</th><th>Outside app?</th><th>Member confirmation</th><th>Venmo received?</th><th>Save status</th></tr></thead>
          <tbody>{visibleRows.length ? visibleRows.map((row, index) => {
            const key = rowKey(row.season, row.week, row.teamId);
            const draft = drafts[key];
            const dirty = pendingKeys.has(key);
            const status = saveStates[key];
            const pick = row.pick;
            return <tr key={key} id={`parlay-row-${row.season}-${row.week}-${row.teamId}`}
              className={`${index === 0 || visibleRows[index - 1].week !== row.week ? "parlay-week-first-row" : ""} ${status === "saved" && !dirty ? "commissioner-row-saved" : ""}`}>
              <td><strong>W{row.week}</strong><div className="admin-secondary">{row.season}</div></td>
              <td><strong>{row.teamName}</strong><div className="admin-secondary">{pick?.submitted_by_name || ""}{pick?.withdrawn_at ? " · Website pick withdrawn" : ""}</div></td>
              <td className="parlay-admin-bet-cell">{row.hasWebsitePick && pick ? <>
                <strong>{pick.player_name}</strong><div className="admin-secondary">{pick.market_name} · {pick.side_id} {pick.line ?? ""} ({pick.odds})</div>
              </> : <>
                {draft.source === "outside" ? <strong className="parlay-offapp-label">Submitted outside the website</strong>
                  : <span className="parlay-no-website-pick">{pick?.withdrawn_at ? "Website pick withdrawn; no active pick" : "Did not submit a pick through the website"}</span>}
                <input className="commissioner-bet-input" maxLength={400} value={draft.details} disabled={busy}
                  onChange={event => edit(key, { details: event.target.value, source: event.target.value.trim() ? "outside" : draft.source })}
                  placeholder="Enter off-app bet details..." aria-label={`Off-app bet details for ${row.teamName}, Week ${row.week}`}/>
              </>}</td>
              <td><select className="commissioner-result-select" value={draft.result} disabled={busy} aria-label={`Result for ${row.teamName}, Week ${row.week}`}
                onChange={event => edit(key, { result: event.target.value as BetResult, source: !row.hasWebsitePick && event.target.value !== "pending" ? "outside" : draft.source })}>
                  {results.map(value => <option value={value} key={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}
                </select></td>
              <td>{row.hasWebsitePick ? <span className="admin-secondary">Website pick</span> : <button type="button" disabled={busy} className={`commissioner-flag ${draft.source === "outside" ? "is-on" : ""}`}
                aria-pressed={draft.source === "outside"} onClick={() => edit(key, draft.source === "outside" ? { source: "none", details: "", result: "pending" } : { source: "outside" })}>
                  {draft.source === "outside" ? "✓ Off-app" : "+ Mark off-app"}
                </button>}</td>
              <td><span className="commissioner-member-note">{row.hasWebsitePick ? (pick?.payment_confirmed_at ? "✓ Claims paid" : "Not confirmed") : "—"}</span></td>
              <td><button type="button" disabled={busy} className={`commissioner-flag ${draft.paid ? "is-on" : ""}`}
                aria-pressed={draft.paid} onClick={() => edit(key, { paid: !draft.paid })}>
                  {draft.paid ? "✓ Received" : "Mark $1 received"}
                </button></td>
              <td><div className="commissioner-save-cell">
                <span className={`commissioner-row-status ${status === "saved" && !dirty ? "is-saved" : dirty ? "is-dirty" : status === "error" ? "is-error" : ""}`}>
                  {status === "error" ? "Could not save" : dirty ? "● Unsaved" : status === "saved" ? "✓ Saved · edit to update" : "Up to date"}
                </span>
                <button type="button" className={`button ${status === "saved" && !dirty ? "small" : "ghost"}`} disabled={busy || !dirty}
                  onClick={() => { const change = diffBet(row, baseline[key], drafts[key]); if (change) void save([change]); }}>
                  {status === "saved" && !dirty ? "✓ Saved" : "Save row"}
                </button>
                {errors[key] ? <small className="commissioner-row-error">{errors[key]}</small> : null}
              </div></td>
            </tr>;
          }) : <tr><td colSpan={8}>No matching teams for the selected filters.</td></tr>}</tbody>
        </table>
      </div>
      <div className="commissioner-bulk-footer">
        <span>{visibleRows.length} of {rows.length} team/week rows shown · {unsavedCount} unsaved</span>
        <button type="button" className="button primary" disabled={busy || !unsavedCount} onClick={() => void save(pending)}>{busy ? "Saving..." : `Save all changes (${unsavedCount})`}</button>
      </div>
    </div>
  );
}
