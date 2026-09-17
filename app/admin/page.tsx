import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { databaseConfigured, listObligations } from "@/lib/supabase";
import { obligationDueLabel } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ synced?: string; error?: string; uploadLink?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const params = await searchParams;
  const obligations = databaseConfigured() ? await listObligations() : [];

  return (
    <section className="page-section">
      <div className="admin-title-row">
        <div className="page-title"><span className="eyebrow">COMMISSIONER</span><h1>Control room</h1><p>Refresh ESPN, manage completion, and create private recap-upload links here.</p></div>
        <form action="/api/admin/logout" method="post"><button className="button ghost">Log out</button></form>
      </div>

      {params.synced ? <div className="notice success">ESPN sync completed.</div> : null}
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
