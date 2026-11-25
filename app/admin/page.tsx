import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { loadCommissionerData } from "@/lib/commissioner-data";
import { initialBet, needsPaymentFollowUp } from "@/lib/parlay-bulk";
import { isOverdue } from "@/lib/format";
import { verifiedNflSundayDate } from "@/lib/nfl-week-calendar";
import { parlayDeadlineIso } from "@/lib/parlay-time";
import { MetricCard } from "@/components/commissioner/MetricCard";
import { HomePaymentQuickAction } from "@/components/commissioner/HomePaymentQuickAction";
import type { ParlayCommissionerRow } from "@/lib/parlay-admin";

export const dynamic = "force-dynamic";

function reconciled(row: ParlayCommissionerRow, verifiedOffapp: Set<string>): boolean {
  const entry = initialBet(row);
  if (entry.result === "no_bet") return true;
  if (row.hasWebsitePick) return true;
  return entry.source === "outside" && verifiedOffapp.has(`${row.week}:${row.teamId}`);
}

export default async function CommissionerHome() {
  if (!(await isAdmin())) redirect("/admin/login");
  const data = await loadCommissionerData({ offApp: true });
  const week = data.currentWeek;
  const currentRows = data.rows.filter(row => row.week === week);
  const offappVerified = new Set(data.offapp.filter(leg => leg.confirmed).map(leg => `${leg.week}:${leg.team_id}`));
  const settledCount = currentRows.filter(row => reconciled(row, offappVerified)).length;
  const due = currentRows.filter(row => needsPaymentFollowUp(row, initialBet(row)));
  const paidCount = currentRows.filter(row => {
    const entry = initialBet(row);
    return entry.result !== "no_bet" && (row.hasWebsitePick || entry.source === "outside") && entry.paid;
  }).length;
  const obligations = data.obligations.filter(item => !item.completed);
  const iceObligations = obligations.filter(item => item.type !== "WEEKLY_RECAP");
  const outstandingIces = iceObligations.reduce((sum, item) => sum + item.penalty_units, 0);
  const outstandingRecaps = obligations.filter(item => item.type === "WEEKLY_RECAP").length;
  const overdue = obligations.filter(item => isOverdue(item));
  const unresolved = data.roster.length === 10 ? currentRows.filter(row => !reconciled(row, offappVerified)) : [];
  const warnings = Number(data.offappUnavailable) + Number(data.rosterUnavailable || data.roster.length !== 10);
  const issueCount = unresolved.length + overdue.length + due.length + warnings;
  const sunday = verifiedNflSundayDate(leagueConfig.season, week);
  const pastDeadline = sunday ? Date.now() >= Date.parse(parlayDeadlineIso(sunday)) : false;
  const paymentDenominator = paidCount + due.length;
  return <section className="page-section commissioner-v2-page">
    <div className="page-title"><span className="eyebrow">COMMISSIONER / HOME</span><h1>League overview</h1>
      <p>Current Week {week} · {leagueConfig.season} season. Quick actions save through existing commissioner controls.</p></div>
    {!data.configured ? <p className="notice error">Supabase is not configured. Live commissioner records are unavailable.</p> : null}
    {data.rosterUnavailable || data.roster.length !== 10 ? <p className="notice error">League roster could not be fully verified. Summaries may be incomplete until ESPN is available.</p> : null}
    {data.offappUnavailable ? <p className="notice error">Verified off-app ticket details could not be loaded. Ticket readiness may be understated.</p> : null}
    <div className="commissioner-metrics">
      <MetricCard label="Sunday parlay" value={`${settledCount}/${currentRows.length || 10}`} hint="Teams reconciled, including No Bet Placed" href="/admin/parlay" />
      <MetricCard label="$1 payments" value={`${paidCount}/${paymentDenominator}`} hint="Commissioner verified / actually due" href="/admin/parlay#weekly-bets" />
      <MetricCard label="Penalties & recaps" value={`${outstandingIces} + ${outstandingRecaps}`} hint="Ices owed + recap obligations" href="/admin/penalties" />
      <MetricCard label="Needs attention" value={issueCount} hint="Unresolved teams, overdue obligations, warnings" href="#action-center" />
    </div>
    <section className="card commissioner-action-center" id="action-center">
      <div className="section-heading"><div><span className="eyebrow">NEXT STEPS</span><h2>Action center</h2></div></div>
      {!issueCount && !due.length ? <p className="parlay-muted">No unresolved issues or payments requiring follow-up right now. Review Live to confirm pregame verification separately.</p> : null}
      {unresolved.slice(0, 5).map(row => <div key={`unresolved-${row.teamId}`} className="commissioner-action-row">
        <div><strong>{row.teamName}: {pastDeadline ? "unreconciled ticket" : "selection still pending"}</strong><small>Week {week} · {pastDeadline ? "Deadline passed. " : "Before the Sunday cutoff. "}Check website submission, structured off-app details, or No Bet Placed.</small></div>
        <a className="button ghost" href={`/admin/parlay?team=${encodeURIComponent(row.teamName)}#weekly-bets`}>Review</a>
      </div>)}
      {due.slice(0, 5).map(row => <div key={`paid-${row.teamId}`} className="commissioner-action-row">
        <div><strong>{row.teamName}: $1 payment pending</strong><small>Week {week} · Commissioner verification only.</small></div>
        <HomePaymentQuickAction season={row.season} week={row.week} teamId={row.teamId} enabled={process.env.VERCEL_ENV === "production"}/>
      </div>)}
      {overdue.slice(0, 5).map(item => <div key={item.id} className="commissioner-action-row">
        <div><strong>{item.team_name}: overdue {item.type === "WEEKLY_RECAP" ? "recap" : "ice penalty"}</strong>
          <small>Week {item.week} · {item.description}</small></div>
        {item.type === "WEEKLY_RECAP" ? <a className="button ghost" href={`/admin/penalties#obligation-${item.id}`}>Manage recap</a> :
        <form action="/api/admin/toggle" method="post"><input type="hidden" name="id" value={item.id}/>
          <input type="hidden" name="completed" value="true"/><input type="hidden" name="returnTo" value="/admin"/>
          <button type="submit" className="button small" disabled={process.env.VERCEL_ENV !== "production"}>Mark complete</button></form>}
      </div>)}
      {due.length > 5 || unresolved.length > 5 || overdue.length > 5 ? <p className="parlay-muted">Additional items are available in Parlay and Penalties.</p> : null}
      <div className="commissioner-action-row"><div><strong>Pregame monitoring readiness</strong>
        <small>Verified snapshots, lineup lock and ESPN live stats are checked separately.</small></div>
        <a className="button ghost" href="/admin/live">Open Live</a></div>
    </section>
  </section>;
}
