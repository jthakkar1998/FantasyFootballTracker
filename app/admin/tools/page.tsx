import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { fetchLeagueSummary, teamDisplayName } from "@/lib/espn";
import { getDb, databaseConfigured } from "@/lib/supabase";
import { recentParlayReminderRuns } from "@/lib/parlay-reminder-diagnostics";
import { listSnapshotRuns } from "@/lib/parlay-snapshot-db";
import { LivePushTest } from "@/components/commissioner/LivePushTest";
import { AdminNotice } from "@/components/commissioner/AdminNotice";

export const dynamic = "force-dynamic";
const central = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));

type Phone = { id: string; team_id: number; created_at: string; updated_at?: string };
type LiveRun = { started_at: string; week: number | null; status: string; eligible_picks: number;
  currently_hitting: number; attempted: number; sent: number; failed: number };
type GradeRun = { started_at: string; week: number; status: string; total: number | null;
  ready: number | null; review: number | null; applied: number | null; errors: unknown };
type Delivery = { alert_key: string; kind: string; source_team_id: number | null; subscription_id: string;
  status: string; attempt_count: number; last_http_status: number | null; last_error: string | null; attempted_at: string; sent_at: string | null };

export default async function ToolsPage({ searchParams }: { searchParams: Promise<{ testPush?: string; error?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  let phones: Phone[] = [], deliveries: Delivery[] = [];
  let reminders: Awaited<ReturnType<typeof recentParlayReminderRuns>> = [];
  let snapshotRuns: Awaited<ReturnType<typeof listSnapshotRuns>> = [];
  let gradeRuns: GradeRun[] = [];
  let liveRuns: LiveRun[] = [];
  let jobError = "";
  let devicesError = "", deliveriesError = "", remindersError = "";
  let names = new Map<number, string>();
  if (databaseConfigured()) {
    const [phonesResult, deliveriesResult, reminderResult, snapshotsResult, gradesResult, liveRunsResult] = await Promise.allSettled([
      getDb().from("parlay_push_subscriptions").select("id,team_id,created_at,updated_at").order("team_id"),
      getDb().from("parlay_ticket_alert_deliveries").select("alert_key,kind,source_team_id,subscription_id,status,attempt_count,last_http_status,last_error,attempted_at,sent_at")
        .eq("season", leagueConfig.season).order("attempted_at", { ascending: false }).limit(70),
      recentParlayReminderRuns(),
      listSnapshotRuns(leagueConfig.season),
      getDb().from("parlay_auto_grade_runs").select("started_at,week,status,total,ready,review,applied,errors")
        .order("started_at", { ascending: false }).limit(12),
      getDb().from("parlay_live_hit_runs").select("started_at,week,status,eligible_picks,currently_hitting,attempted,sent,failed")
        .eq("season",leagueConfig.season).order("started_at",{ascending:false}).limit(20)
    ]);
    if (phonesResult.status === "fulfilled" && !phonesResult.value.error) phones = (phonesResult.value.data ?? []) as Phone[];
    else devicesError = "Device registration summary is unavailable.";
    if (deliveriesResult.status === "fulfilled" && !deliveriesResult.value.error) deliveries = (deliveriesResult.value.data ?? []) as Delivery[];
    else deliveriesError = "Live ticket delivery history is unavailable.";
    if (reminderResult.status === "fulfilled") reminders = reminderResult.value;
    else remindersError = "Reminder run diagnostics are unavailable.";
    if (snapshotsResult.status === "fulfilled") snapshotRuns = snapshotsResult.value.slice(0, 20);
    else jobError = "Snapshot job activity unavailable.";
    if (gradesResult.status === "fulfilled" && !gradesResult.value.error) gradeRuns = (gradesResult.value.data ?? []) as GradeRun[];
    else jobError += " Auto-grade job activity unavailable.";
    if (liveRunsResult.status === "fulfilled" && !liveRunsResult.value.error) liveRuns = (liveRunsResult.value.data ?? []) as LiveRun[];
    else jobError += " Live monitoring run history unavailable.";
  }
  try { const summary = await fetchLeagueSummary(); names = new Map((summary.teams ?? []).map(t => [t.id, teamDisplayName(t,t.id)])); }
  catch { /* Show safe team IDs if ESPN is temporarily unavailable. */ }
  const phoneLabels = phones.map(p => ({ id: p.id, teamName: names.get(p.team_id) ?? `Team ${p.team_id}` }));
  const countByTeam = new Map<number, number>();
  for (const p of phones) countByTeam.set(p.team_id, (countByTeam.get(p.team_id) ?? 0) + 1);
  const deviceLabel = new Map(phones.map(p => [p.id, names.get(p.team_id) ?? `Team ${p.team_id}`]));
  return <section className="page-section commissioner-v2-page">
    <div className="page-title"><span className="eyebrow">COMMISSIONER / TOOLS</span><h1>Notifications & diagnostics</h1>
      <p>Technical tools live here, separate from Sunday ticket management. No checks on this page change official grades or ticket state.</p></div>
    <AdminNotice params={await searchParams}/>
    <div className="commissioner-summary-strip"><span><strong>{phones.length}</strong> registered devices</span>
      <span><strong>{countByTeam.size}</strong> teams with devices</span><span><strong>{deliveries.length}</strong> recent delivery records</span></div>
    <section className="card commissioner-tool-section"><h2>Push registrations & test notifications</h2>
      {devicesError ? <p className="notice error">{devicesError}</p> : null}
      <div className="commissioner-device-grid">
        {[...countByTeam.entries()].sort((a,b) => (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? "")).map(([teamId,count]) =>
          <div key={teamId} className="commissioner-device-row"><strong>{names.get(teamId) ?? `Team ${teamId}`}</strong><span>{count} device{count === 1 ? "" : "s"}</span>
          <form action="/api/admin/parlay/test-push" method="post"><input type="hidden" name="teamId" value={teamId}/>
            <button className="button ghost" type="submit" disabled={process.env.VERCEL_ENV !== "production"}>Generic test to team</button></form></div>)}
      </div>
      <details className="commissioner-fold"><summary>Test actual live HIT / DEAD payload on one device</summary>
        <LivePushTest phones={phoneLabels} production={process.env.VERCEL_ENV === "production"}/>
      </details>
    </section>
    <details className="commissioner-fold"><summary>Recent league-wide delivery attempts (read-only)</summary>
      <div className="card"><p className="parlay-muted">"Sent" means a push provider accepted the request. It does not establish that an iPhone displayed the notification. Subscription URLs and keys are not exposed.</p>
        {deliveriesError ? <p className="notice error">{deliveriesError}</p> : null}
        <div className="table-wrap"><table className="commissioner-tools-table"><thead><tr><th>Time (Central)</th><th>Device team</th><th>Alert</th><th>Status</th><th>HTTP</th><th>Attempts</th><th>Details</th></tr></thead>
          <tbody>{deliveries.length ? deliveries.map((d,i) => <tr key={`${d.subscription_id}-${d.alert_key}-${i}`}>
            <td>{central(d.attempted_at)}</td><td>{deviceLabel.get(d.subscription_id) ?? "Previously registered device"}</td>
            <td>{d.kind.toUpperCase()}</td><td>{d.status}</td><td>{d.last_http_status ?? "—"}</td><td>{d.attempt_count}</td><td>{d.last_error ?? "—"}</td>
          </tr>) : <tr><td colSpan={7}>No saved delivery attempts found for this season.</td></tr>}</tbody></table></div>
      </div>
    </details>
    <details className="commissioner-fold"><summary>Missing-pick reminder diagnostics</summary>
      <div className="card"><p className="parlay-muted">Established Supabase Cron runs Thursday–Saturday at 8 PM and Sunday at 9 AM/11:30 AM Central with guarded retries.</p>
        {remindersError ? <p className="notice error">{remindersError}</p> : null}
        <div className="table-wrap"><table className="commissioner-tools-table"><thead><tr><th>Run (Central)</th><th>Slot</th><th>Status</th><th>Missing teams</th><th>Eligible devices</th><th>Sent</th><th>Retried</th><th>Failed</th></tr></thead>
          <tbody>{reminders.length ? reminders.map(run => <tr key={run.id}><td>{central(run.started_at)}</td><td>{run.slot ?? "—"}</td>
            <td title={run.error_message ?? undefined}>{run.status}</td><td>{run.missing_teams}</td><td>{run.eligible_devices}</td>
            <td>{run.sent}</td><td>{run.retried}</td><td>{run.failed}</td></tr>) : <tr><td colSpan={8}>No reminder runs recorded.</td></tr>}</tbody></table></div>
      </div>
    </details>
    <details className="commissioner-fold"><summary>Snapshot & final grading job history</summary>
      <div className="card">
        <p className="parlay-muted">Recorded job outcomes only. Supabase Cron activation, schedules and execution history remain authoritative in Supabase; this page does not create or run jobs.</p>
        {jobError ? <p className="notice error">{jobError}</p> : null}
        <h3>Pregame snapshot runs</h3><div className="table-wrap"><table className="commissioner-tools-table"><thead>
          <tr><th>Run (Central)</th><th>Week</th><th>Slot</th><th>Status</th><th>Attempted</th><th>Captured</th></tr>
          </thead><tbody>{snapshotRuns.length ? snapshotRuns.slice(0,20).map(run => <tr key={run.id}>
            <td>{central(run.started_at)}</td><td>{run.week}</td><td>{run.slot}</td><td>{run.status}</td>
            <td>{run.attempted}</td><td>{run.captured}</td></tr>) : <tr><td colSpan={6}>No recent snapshot runs.</td></tr>}</tbody>
        </table></div>
        <h3>Live monitor runs</h3><div className="table-wrap"><table className="commissioner-tools-table"><thead>
          <tr><th>Run (Central)</th><th>Week</th><th>Status</th><th>Eligible picks</th><th>Hitting</th><th>Sent</th><th>Failed</th></tr>
          </thead><tbody>{liveRuns.length ? liveRuns.map((run,index) => <tr key={`${run.started_at}-${index}`}>
            <td>{central(run.started_at)}</td><td>{run.week ?? "—"}</td><td>{run.status}</td>
            <td>{run.eligible_picks}</td><td>{run.currently_hitting}</td><td>{run.sent}</td><td>{run.failed}</td>
          </tr>) : <tr><td colSpan={7}>No recent live monitor runs.</td></tr>}</tbody></table></div>
        <h3>Final auto-grading runs</h3><div className="table-wrap"><table className="commissioner-tools-table"><thead>
          <tr><th>Run (Central)</th><th>Week</th><th>Status</th><th>Ready</th><th>Review</th><th>Applied</th></tr>
          </thead><tbody>{gradeRuns.length ? gradeRuns.map((run,index) => <tr key={`${run.started_at}-${index}`}>
            <td>{central(run.started_at)}</td><td>{run.week}</td><td>{run.status}</td>
            <td>{run.ready ?? "—"}</td><td>{run.review ?? "—"}</td><td>{run.applied ?? "—"}</td>
          </tr>) : <tr><td colSpan={6}>No recent grading runs.</td></tr>}</tbody></table></div>
      </div>
    </details>
    <details className="commissioner-fold"><summary>System configuration & scheduled jobs</summary>
      <div className="card"><p className="parlay-muted">Live sending and grading switches are displayed without exposing credential values. Supabase Cron job inventory must still be verified in Supabase itself.</p>
        <div className="commissioner-summary-strip">
          <span>Live: <strong>{process.env.PARLAY_LIVE_HITS_ENABLED === "true" ? "Enabled" : "Off"}</strong></span>
          <span>League broadcast: <strong>{process.env.PARLAY_LEAGUE_TICKET_NOTIFICATIONS_ENABLED === "true" ? "Enabled" : "Off"}</strong></span>
          <span>Auto-grading: <strong>{process.env.PARLAY_AUTO_GRADING_ENABLED === "true" ? "Enabled" : "Off"}</strong></span>
        </div>
        <p className="parlay-muted">Read-only snapshot run logs remain available in <a href="/admin/live">Live → FanDuel pregame snapshots</a>. Automatic grading preview and activity remain in <a href="/admin/parlay">Parlay → Final grading</a>. The underlying Cron schedules and keys are unchanged.</p>
      </div>
    </details>
  </section>;
}
