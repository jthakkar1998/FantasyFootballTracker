import Link from "next/link";
import { listParlayHistory } from "@/lib/parlay-db";
import { databaseConfigured } from "@/lib/supabase";
import type { ParlaySubmission } from "@/lib/parlay-types";

export const dynamic = "force-dynamic";

function betDescription(pick: ParlaySubmission) {
  const side = pick.side_id.slice(0, 1).toUpperCase() + pick.side_id.slice(1).toLowerCase();
  return `${pick.player_name} — ${pick.market_name} · ${side}${pick.line ? ` ${pick.line}` : ""} (${pick.odds})`;
}

export default async function ParlayHistoryPage() {
  if (!databaseConfigured()) return <section className="card empty-state"><h1>Parlay history unavailable</h1><p>Configure Supabase to view results.</p></section>;
  try {
    const picks = (await listParlayHistory()).filter(item => !item.withdrawn_at);
    const settled = picks.filter(item => item.result_status !== "pending");
    const hit = settled.filter(item => item.result_status === "hit").length;
    const missed = settled.filter(item => item.result_status === "miss").length;
    const weeks = [...new Set(picks.map(pick => `${pick.season}-${pick.week}`))].sort((a,b) => {
      const [as, aw] = a.split("-").map(Number); const [bs,bw] = b.split("-").map(Number);
      return bs-as || bw-aw;
    });
    return (
      <section className="page-section">
        <div className="page-title"><span className="eyebrow">GROUP PARLAY ARCHIVE</span><h1>Bet history</h1>
          <p>Every final weekly leg and its recorded result. Jay grades completed bets in the commissioner dashboard.</p>
        </div>
        <div className="history-kpis">
          <div className="card"><span>Weekly legs</span><strong>{picks.length}</strong></div>
          <div className="card"><span>Hits</span><strong>{hit}</strong></div>
          <div className="card"><span>Misses</span><strong>{missed}</strong></div>
          <div className="card"><span>Awaiting grading</span><strong>{picks.filter(p => p.result_status === "pending").length}</strong></div>
        </div>
        <p><Link href="/parlay" className="button ghost">← Back to this week&apos;s picks</Link></p>
        {weeks.length ? weeks.map(weekKey => (
          <section key={weekKey} className="section-block">
            <div className="section-heading"><h2>{weekKey.split("-")[0]} · Week {weekKey.split("-")[1]}</h2><span className="count-chip">{picks.filter(p => `${p.season}-${p.week}` === weekKey).length} picks</span></div>
            <div className="table-wrap card"><table><thead><tr><th>Team</th><th>Submitted by</th><th>Player prop</th><th>Outcome</th></tr></thead><tbody>
              {picks.filter(p => `${p.season}-${p.week}` === weekKey).map(pick => <tr key={pick.id}>
                <td>{pick.team_name}</td><td>{pick.submitted_by_name || "—"}</td>
                <td>{betDescription(pick)}</td><td><span className={`parlay-result ${pick.result_status}`}>{pick.result_status}</span></td>
              </tr>)}
            </tbody></table></div>
          </section>
        )) : <section className="card empty-state"><h2>No parlay picks yet</h2><p>Submitted legs will appear here each week.</p></section>}
      </section>
    );
  } catch (error) {
    return <section className="card empty-state"><h1>Parlay history unavailable</h1><p>{error instanceof Error ? error.message : "Could not retrieve bet history."}</p></section>;
  }
}
