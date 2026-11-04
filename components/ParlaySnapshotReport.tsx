"use client";

import { useMemo, useState } from "react";
import { chooseGradingSnapshot, type SnapshotPick, type SnapshotRecord } from "@/lib/parlay-snapshot-core";
import type { SnapshotRun } from "@/lib/parlay-snapshot-db";

function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
  }).format(new Date(iso));
}

function betLine(pick: SnapshotPick, line: string | null): string {
  const side = pick.side_id.charAt(0).toUpperCase() + pick.side_id.slice(1);
  return line === null ? side : `${side} ${line}`;
}

export function ParlaySnapshotReport({ season, currentWeek, picks, snapshots, runs }: {
  season: number;
  currentWeek: number;
  picks: SnapshotPick[];
  snapshots: SnapshotRecord[];
  runs: SnapshotRun[];
}) {
  const weeks = useMemo(() => [...new Set([currentWeek, ...picks.map(pick => pick.week), ...runs.map(run => run.week)])]
    .filter(week => Number.isFinite(week)).sort((a, b) => b - a), [currentWeek, picks, runs]);
  const [week, setWeek] = useState(currentWeek);
  const weekPicks = useMemo(() => picks.filter(pick => pick.week === week), [picks, week]);
  const weekRuns = runs.filter(run => run.week === week);
  const weekSnapshots = snapshots.filter(record => record.week === week);
  const primaryCount = weekPicks.filter(pick => chooseGradingSnapshot(pick, weekSnapshots).source === "primary").length;
  const backupCount = weekPicks.filter(pick => chooseGradingSnapshot(pick, weekSnapshots).source === "backup").length;

  return <div className="card snapshot-report">
    <div className="snapshot-report-header">
      <div>
        <h3>Sunday FanDuel line snapshots</h3>
        <p className="parlay-muted">Read-only Phase 1 monitoring. Lines here do not grade bets or change $1 payment records.</p>
      </div>
      <label className="snapshot-week-select">Week
        <select aria-label="Snapshot week" value={week} onChange={event => setWeek(Number(event.target.value))}>
          {weeks.map(item => <option key={item} value={item}>Week {item} · {season}</option>)}
        </select>
      </label>
    </div>
    <div className="snapshot-summary">
      <span><strong>{weekPicks.length}</strong> website picks</span>
      <span><strong>{primaryCount}</strong> primary lines</span>
      <span><strong>{backupCount}</strong> backup fallbacks</span>
      <span><strong>{weekPicks.length - primaryCount - backupCount}</strong> need review / not yet captured</span>
    </div>
    <div className="table-wrap">
      <table className="snapshot-table">
        <thead><tr><th>Fantasy team</th><th>Submitted prop</th><th>11:45 backup</th><th>11:56 primary</th><th>Line for future grading</th></tr></thead>
        <tbody>{weekPicks.length === 0 ? <tr><td colSpan={5}>No active website-submitted picks for this week. Off-app bets remain manual.</td></tr> :
          weekPicks.map(pick => {
            const matching = weekSnapshots.filter(record => record.submission_id === pick.id &&
              record.event_id === pick.event_id && record.market_id === pick.market_id &&
              record.sportsbook_player_id === pick.sportsbook_player_id &&
              record.side_id === pick.side_id && record.stat_id === pick.stat_id);
            const backup = matching.find(record => record.snapshot_slot === "backup");
            const primary = matching.find(record => record.snapshot_slot === "primary");
            const choice = chooseGradingSnapshot(pick, weekSnapshots);
            return <tr key={pick.id}>
              <td><strong>{pick.team_name}</strong></td>
              <td><strong>{pick.player_name}</strong><small>{pick.market_name} · {betLine(pick, pick.line)} (original)</small></td>
              <td>{backup ? <><strong>{betLine(pick, backup.line)}</strong><small title={`FanDuel quote: ${localTime(backup.quote_updated_at)}`}>Saved {localTime(backup.captured_at)}</small></> : <span className="snapshot-muted">Not captured</span>}</td>
              <td>{primary ? <><strong>{betLine(pick, primary.line)}</strong><small title={`FanDuel quote: ${localTime(primary.quote_updated_at)}`}>Saved {localTime(primary.captured_at)}</small></> : <span className="snapshot-muted">Not captured</span>}</td>
              <td>{choice.selected ? <>
                <span className={`snapshot-tag ${choice.source}`}>{choice.source === "primary" ? "Primary" : "Backup fallback"}</span>
                <strong>{betLine(pick, choice.selected.line)}</strong>
                <small>FanDuel quote updated {localTime(choice.selected.quote_updated_at)}</small>
              </> : <span className="snapshot-tag missing">Manual review / pending</span>}</td>
            </tr>;
          })}</tbody>
      </table>
    </div>
    <details className="snapshot-run-details">
      <summary>Snapshot job activity ({weekRuns.length})</summary>
      <div className="table-wrap"><table><thead><tr><th>Run (Central)</th><th>Slot</th><th>Status</th><th>Attempted</th><th>Captured</th><th>Errors</th></tr></thead>
        <tbody>{weekRuns.length ? weekRuns.map(run => <tr key={run.id}>
          <td>{localTime(run.started_at)}</td><td>{run.slot}</td><td>{run.status}</td><td>{run.attempted}</td><td>{run.captured}</td>
          <td>{(run.error_message || run.failures?.map(failure => `${failure.team}: ${failure.reason}`).join("; ") || "—") + (run.usage_warning ? ` · ${run.usage_warning}` : "")}</td>
        </tr>) : <tr><td colSpan={6}>No recorded snapshot attempts for this week.</td></tr>}</tbody>
      </table></div>
    </details>
    <p className="parlay-muted snapshot-footnote">If a player or market was changed after 11:45, its previous backup is ignored. FanDuel quotes may lag the live sportsbook on the Amateur API plan. Phase 2 grading will need a validated primary line or labeled backup; otherwise it will require review.</p>
  </div>;
}
