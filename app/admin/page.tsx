import { leagueConfig } from "@/lib/config";
import { listParlayHistory } from "@/lib/parlay-db";
import { notificationRegistrationCounts } from "@/lib/parlay-notifications";
import { getCurrentParlayContext } from "@/lib/parlay";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { databaseConfigured, listObligations } from "@/lib/supabase";
import { obligationDueLabel } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ synced?: string; error?: string; uploadLink?: string; testPush?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const params = await searchParams;
  const obligations = databaseConfigured() ? await listObligations() : [];
  const parlayHistory = databaseConfigured() ? await listParlayHistory() : [];
  // Device totals only; subscription endpoint URLs and keys never appear in the HTML.
  const deviceCounts = databaseConfigured() ? await notificationRegistrationCounts() : new Map<number, number>();
  const activePicks = parlayHistory.filter(pick => !pick.withdrawn_at);
  let thisWeek: { week: number; teams: { teamId: number; teamName: string }[] } | null = null;
  if (databaseConfigured()) {
    try {
      const context = await getCurrentParlayContext();
      thisWeek = { week: context.week, teams: context.teams };
    } catch { /* Keep commissioner payment/history available when ESPN is unavailable. */ }
  }
  const currentPicks = thisWeek ? activePicks.filter(pick => pick.season === leagueConfig.season && pick.week === thisWeek!.week) : [];

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
        <div className="section-heading"><div><span className="eyebrow">PARLAY COMMISSIONER</span><h2>Weekly bets & $1 payments</h2></div>
          <span className="count-chip">{activePicks.filter(p => !p.payment_verified_at).length} unverified payments</span>
        </div>
        <p className="parlay-muted">Members confirm payment when submitting; only you verify that the money reached Venmo. Grade bets manually after games finish. Withdrawn picks keep their payment record but are excluded from the public history.</p>
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
        <div className="table-wrap card admin-table"><table>
          <thead><tr><th>Week</th><th>Team / member</th><th>Bet</th><th>Member confirmation</th><th>Venmo received?</th><th>Result</th></tr></thead>
          <tbody>{parlayHistory.length ? parlayHistory.map(pick => (
            <tr key={pick.id}>
              <td>{pick.season} W{pick.week}</td>
              <td><strong>{pick.team_name}</strong><div className="admin-secondary">{pick.submitted_by_name || "No member recorded"}{pick.withdrawn_at ? " · WITHDRAWN" : ""}</div></td>
              <td>{pick.player_name}<div className="admin-secondary">{pick.market_name} · {pick.side_id} {pick.line ?? ""} ({pick.odds})</div></td>
              <td>{pick.payment_confirmed_at ? "✓ Claims paid" : "Not confirmed"}</td>
              <td><form action="/api/admin/parlay/update" method="post"><input type="hidden" name="id" value={pick.id}/><input type="hidden" name="kind" value="payment"/>
                <input type="hidden" name="value" value={pick.payment_verified_at ? "unverified" : "verified"}/>
                <button className={`button ${pick.payment_verified_at ? "small" : "ghost"}`} type="submit">{pick.payment_verified_at ? "✓ Verified · undo" : "Mark $1 received"}</button>
              </form></td>
              <td>{pick.withdrawn_at ? "Withdrawn" : <form action="/api/admin/parlay/update" method="post" className="result-form">
                <input type="hidden" name="id" value={pick.id}/><input type="hidden" name="kind" value="result"/>
                <select name="value" defaultValue={pick.result_status} aria-label={`Outcome for ${pick.team_name}, week ${pick.week}`}>
                  <option value="pending">Pending</option><option value="hit">Hit</option><option value="miss">Miss</option><option value="push">Push</option><option value="void">Void</option>
                </select><button className="button ghost" type="submit">Save</button>
              </form>}</td>
            </tr>
          )) : <tr><td colSpan={6}>No parlay submissions yet.</td></tr>}</tbody>
        </table></div>
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
