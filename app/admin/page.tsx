import { leagueConfig } from "@/lib/config";
import { listParlayHistory } from "@/lib/parlay-db";
import { listParlayWeeklyTeamTracking } from "@/lib/parlay-tracking-db";
import { makeParlayCommissionerRows } from "@/lib/parlay-admin";
import { fetchLeagueSummary, teamDisplayName } from "@/lib/espn";
import { notificationRegistrationCounts } from "@/lib/parlay-notifications";
import { getCurrentParlayContext } from "@/lib/parlay";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { databaseConfigured, listObligations } from "@/lib/supabase";
import { obligationDueLabel } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import { CommissionerParlayManager } from "@/components/CommissionerParlayManager";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ synced?: string; error?: string; uploadLink?: string; testPush?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const params = await searchParams;
  const obligations = databaseConfigured() ? await listObligations() : [];
  const parlayHistory = databaseConfigured() ? await listParlayHistory() : [];
  const tracking = databaseConfigured() ? await listParlayWeeklyTeamTracking(leagueConfig.season) : [];
  // Device totals only; subscription endpoint URLs and keys never appear in the HTML.
  const deviceCounts = databaseConfigured() ? await notificationRegistrationCounts() : new Map<number, number>();
  const activePicks = parlayHistory.filter(pick => !pick.withdrawn_at);
  let thisWeek: { week: number; teams: { teamId: number; teamName: string }[] } | null = null;
  let roster: { teamId: number; teamName: string }[] = [];
  let currentWeek = 1;
  let rosterUnavailable = false;
  if (databaseConfigured()) {
    try {
      // Read the full ESPN league roster rather than only teams with a submission.
      // This also avoids requiring the NFL odds/deadline API to build history.
      const summary = await fetchLeagueSummary();
      roster = (summary.teams ?? []).map(team => ({ teamId: team.id, teamName: teamDisplayName(team, team.id) }));
      if (roster.length === 0) rosterUnavailable = true;
      const reportedWeek = Number(summary.status?.currentMatchupPeriod ?? summary.scoringPeriodId ?? summary.status?.latestScoringPeriod ?? 1);
      currentWeek = Number.isFinite(reportedWeek) ? Math.max(1, Math.floor(reportedWeek)) : 1;
    } catch {
      rosterUnavailable = true;
      // Still display all recorded rows even if ESPN is temporarily unreachable.
    }
    try {
      const context = await getCurrentParlayContext();
      thisWeek = { week: context.week, teams: context.teams };
      currentWeek = Math.max(currentWeek, context.week);
      if (!roster.length) roster = context.teams.map(team => ({ teamId: team.teamId, teamName: team.teamName }));
    } catch { /* Keep commissioner payment/history available when ESPN or NFL is unavailable. */ }
  }
  if (!roster.length) {
    // Last-resort fallback: completed punishment syncs may provide additional
    // team identities even when ESPN is temporarily unreachable.
    roster = [...new Map(obligations.filter(item => item.season === leagueConfig.season)
      .map(item => [item.team_id, { teamId: item.team_id, teamName: item.team_name }] as const)).values()];
  }
  const currentPicks = thisWeek ? activePicks.filter(pick => pick.season === leagueConfig.season && pick.week === thisWeek.week) : [];
  const commissionerRows = makeParlayCommissionerRows({
    season: leagueConfig.season, throughWeek: currentWeek,
    teams: roster, submissions: parlayHistory, tracking
  });

  return (
    <section className="page-section">
      <div className="admin-title-row">
        <div className="page-title"><span className="eyebrow">COMMISSIONER</span><h1>Control room</h1><p>Refresh ESPN, manage completion, and create private recap-upload links here.</p></div>
        <form action="/api/admin/logout" method="post"><button className="button ghost">Log out</button></form>
      </div>

      {params.synced ? <div className="notice success">ESPN sync completed.</div> : null}
      {params.testPush ? <div className="notice success">Test push accepted by {params.testPush.replace("-", "/")} registered push services. Check your phones.</div> : null}
      {params.error ? <div className="notice error">Action failed: {params.error}</div> : null}
      {params.uploadLink ? (
        <div className="notice success upload-link-notice">
          <strong>Private recap link created.</strong>
          <p>Copy this link and send it only to that week&apos;s recap loser. Generating another link replaces this one.</p>
          <input readOnly value={params.uploadLink} aria-label="Recap upload link" />
        </div>
      ) : null}

      <div className="admin-actions card">
        <div><h2>ESPN synchronization</h2><p>The daily job runs automatically. Use this after deployment or whenever you want to refresh immediately.</p></div>
        <form action="/api/admin/sync" method="post"><button className="button primary" disabled={!databaseConfigured()}>Sync ESPN now</button></form>
      </div>

      <section id="parlay-management" className="section-block">
        <div className="section-heading"><div><span className="eyebrow">PARLAY COMMISSIONER</span><h2>Weekly bets & $1 payments</h2></div></div>
        <p className="parlay-muted">Every fantasy team appears for every week of {leagueConfig.season}, starting with Week 1. Website picks are displayed automatically. For bets messaged to you instead, select <strong>Mark off-app pick</strong>, optionally record the bet, and verify the $1 when received. Grading and payment records are commissioner-only.</p>
        {rosterUnavailable ? <div className="notice error">ESPN team list is temporarily unavailable. Showing known teams from saved records only; refresh when ESPN is available to see the full league.</div> : null}
        {thisWeek ? (
          <div className="card parlay-admin-status"><strong>Week {thisWeek.week} submission & notification status</strong><div className="parlay-admin-team-grid">
            {thisWeek.teams.map(team => {
              const submitted = currentPicks.some(p => p.team_id === team.teamId);
              return <div key={team.teamId}><span>{team.teamName}</span><b>{submitted ? "✓ Pick submitted" : "○ No pick"}</b><small>{deviceCounts.get(team.teamId) ?? 0} phone(s) subscribed</small>
                {(deviceCounts.get(team.teamId) ?? 0) > 0 ? <form action="/api/admin/parlay/test-push" method="post"><input type="hidden" name="teamId" value={team.teamId}/><button type="submit" className="button ghost">Send test push</button></form> : null}
              </div>;
            })}
          </div></div>
        ) : null}
        <CommissionerParlayManager rows={commissionerRows} season={leagueConfig.season} />
      </section>

      <div className="table-wrap card admin-table">
        <table>
          <thead><tr><th>Week</th><th>Team</th><th>Obligation</th><th>Due</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {obligations.length ? obligations.map((item) => (
              <tr key={item.id}>
                <td>W{item.week}</td>
                <td>{item.team_name}</td>
                <td>{item.type === "WEEKLY_RECAP" ? (item.video_path ? "Video recap · uploaded" : "Video recap") : item.description}</td>
                <td>{obligationDueLabel(item)}</td>
                <td><StatusPill item={item} /></td>
                <td>
                  <div className="action-stack">
                    {item.type === "WEEKLY_RECAP" && !item.video_path ? (
                      <form action="/api/admin/recap-link" method="post">
                        <input type="hidden" name="id" value={item.id} />
                        <button className="button primary" type="submit">Create upload link</button>
                      </form>
                    ) : null}
                    <form action="/api/admin/toggle" method="post">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="completed" value={item.completed ? "false" : "true"} />
                      <button className={`button ${item.completed ? "ghost" : "small"}`} type="submit">
                        {item.completed ? "Reopen" : "Mark complete"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={6}>No obligations yet. Run Sync ESPN now.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
