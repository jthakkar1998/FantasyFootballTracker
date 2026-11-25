import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { listParlayHistory } from "@/lib/parlay-db";
import { databaseConfigured } from "@/lib/supabase";
import { listSnapshots, listSnapshotRuns } from "@/lib/parlay-snapshot-db";
import { ParlayLiveHitReport } from "@/components/ParlayLiveHitReport";
import { ParlaySnapshotReport } from "@/components/ParlaySnapshotReport";
import { loadCommissionerData } from "@/lib/commissioner-data";

export const dynamic = "force-dynamic";
export default async function LivePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const data = await loadCommissionerData();
  let snapshots: Awaited<ReturnType<typeof listSnapshots>> = [];
  let snapshotRuns: Awaited<ReturnType<typeof listSnapshotRuns>> = [];
  let snapshotsError = false;
  if (databaseConfigured()) {
    try { [snapshots, snapshotRuns] = await Promise.all([listSnapshots(leagueConfig.season), listSnapshotRuns(leagueConfig.season)]); }
    catch { snapshotsError = true; }
  }
  return <section className="page-section commissioner-v2-page">
    <div className="page-title"><span className="eyebrow">COMMISSIONER / LIVE</span><h1>Sunday live ticket</h1>
      <p>Pregame verification, player-by-player monitoring and league ticket status. These previews do not settle wagers or send notifications.</p></div>
    <ParlayLiveHitReport enabled={process.env.PARLAY_LIVE_HITS_ENABLED === "true" && process.env.PARLAY_LEAGUE_TICKET_NOTIFICATIONS_ENABLED === "true"}/>
    <details className="commissioner-fold"><summary>FanDuel pregame snapshots & activity</summary>
      {snapshotsError ? <p className="notice error">Snapshot data is unavailable. Review the existing snapshot migration and API logs.</p> :
        <ParlaySnapshotReport season={leagueConfig.season} currentWeek={data.currentWeek}
          picks={data.history.filter(p => !p.withdrawn_at && p.season === leagueConfig.season)}
          snapshots={snapshots} runs={snapshotRuns} />}
    </details>
    <p className="parlay-muted">The live monitor runs on the established Supabase Cron schedule. Use <a href="/admin/tools">Tools</a> to inspect actual push-provider delivery attempts and test individual devices.</p>
  </section>;
}
