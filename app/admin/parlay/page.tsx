import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { loadCommissionerData } from "@/lib/commissioner-data";
import { CommissionerParlayManager } from "@/components/CommissionerParlayManager";
import { ParlayGradingReport } from "@/components/ParlayGradingReport";
import { listSnapshots } from "@/lib/parlay-snapshot-db";
import { AdminNotice } from "@/components/commissioner/AdminNotice";

export const dynamic = "force-dynamic";
export default async function CommissionerParlay({ searchParams }: { searchParams: Promise<{ error?: string; team?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const params = await searchParams;
  const data = await loadCommissionerData({ eligiblePlayers: true, offApp: true });
  let snapshotWeeks: number[] = [];
  let snapshotUnavailable = false;
  if (data.configured) {
    try { snapshotWeeks = [...new Set((await listSnapshots(leagueConfig.season)).map(item => item.week))]; }
    catch { snapshotUnavailable = true; }
  }
  return <section className="page-section commissioner-v2-page">
    <div className="page-title"><span className="eyebrow">COMMISSIONER / PARLAY</span><h1>Bets & payments</h1>
      <p>Track all ten fantasy teams each week, confirm $1 payments, manage off-app legs, and review finalized results.</p></div>
    <AdminNotice params={params}/>
    {data.offappUnavailable ? <p className="notice error">Verified off-app details are unavailable. Check the existing migration before editing structured tickets.</p> : null}
    {data.rosterUnavailable ? <p className="notice error">ESPN team roster is temporarily unavailable. Saved team/week rows remain accessible.</p> : null}
    <section id="weekly-bets"><div className="section-heading"><h2>Weekly bets & $1 payments</h2></div>
      <CommissionerParlayManager rows={data.rows} season={leagueConfig.season} currentWeek={data.thisWeek?.week ?? data.currentWeek}
        eligibleByTeam={Object.fromEntries((data.thisWeek?.teams ?? []).map(team => [team.teamId, team.eligiblePlayers]))}
        offappLegs={data.offapp} initialTeamFilter={(params.team ?? "").slice(0, 100)}/>
    </section>
    <details className="commissioner-fold"><summary>Final grading & manual review</summary>
      {snapshotUnavailable ? <p className="notice error">Snapshot/grading data unavailable.</p> :
        <ParlayGradingReport currentWeek={data.currentWeek} snapshotWeeks={snapshotWeeks}
          writesEnabled={process.env.PARLAY_AUTO_GRADING_ENABLED === "true"} />}
    </details>
    <p className="parlay-muted">For pregame reference lines and live ticket monitoring, use <a href="/admin/live">Live</a>. For device registration and reminder diagnostics, use <a href="/admin/tools">Tools</a>.</p>
  </section>;
}
