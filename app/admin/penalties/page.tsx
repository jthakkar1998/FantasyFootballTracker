import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { databaseConfigured, listObligations } from "@/lib/supabase";
import { PenaltiesBoard } from "@/components/commissioner/PenaltiesBoard";
import { AdminNotice } from "@/components/commissioner/AdminNotice";

export const dynamic = "force-dynamic";
export default async function PenaltiesPage({ searchParams }: { searchParams: Promise<{ synced?: string; error?: string; uploadLink?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const params = await searchParams;
  const obligations = databaseConfigured() ? await listObligations() : [];
  const open = obligations.filter(item => !item.completed);
  const ices = open.filter(item => item.type !== "WEEKLY_RECAP").reduce((sum,item) => sum + item.penalty_units, 0);
  return <section className="page-section commissioner-v2-page">
    <div className="page-title"><span className="eyebrow">COMMISSIONER / PENALTIES</span><h1>Fantasy obligations</h1>
      <p>Manage ice penalties and video recaps by team or by obligation type. Individual status changes use the existing database workflow.</p></div>
    <AdminNotice params={params}/>
    <div className="commissioner-summary-strip"><span><strong>{ices}</strong> ices outstanding</span>
      <span><strong>{open.filter(item => item.type === "WEEKLY_RECAP").length}</strong> recaps owed</span>
      <span><strong>{new Set(open.map(item => item.team_id)).size}</strong> teams affected</span></div>
    <PenaltiesBoard obligations={obligations} writesEnabled={process.env.VERCEL_ENV === "production"}/>
    <details className="commissioner-fold"><summary>ESPN synchronization</summary>
      <div className="card admin-actions"><div><h2>Refresh league results</h2><p>The existing daily ESPN sync continues automatically. Manual refresh may reconcile previously corrected NFL scores.</p></div>
        <form action="/api/admin/sync" method="post"><button className="button primary" disabled={!databaseConfigured() || process.env.VERCEL_ENV !== "production"}>Sync ESPN now</button></form></div>
    </details>
    <p className="parlay-muted">Previously uploaded recap videos remain accessible through the public recap archive. Existing replacement/delete handling remains unchanged.</p>
  </section>;
}
