import { StatusPill } from "@/components/StatusPill";
import { TeamIdentity } from "@/components/TeamIdentity";
import { obligationDueLabel } from "@/lib/format";
import { databaseConfigured, listObligations } from "@/lib/supabase";
import type { Obligation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const obligations: Obligation[] = databaseConfigured() ? await listObligations() : [];

  return (
    <section className="page-section">
      <div className="page-title"><span className="eyebrow">ARCHIVE</span><h1>Season history</h1><p>Every generated obligation remains here after completion.</p></div>
      <div className="table-wrap card history-table">
        <table>
          <thead><tr><th>Week</th><th>Team</th><th>Reason</th><th>Ices owed</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {obligations.length ? obligations.map((item) => (
              <tr key={item.id}>
                <td>W{item.week}</td>
                <td><TeamIdentity name={item.team_name} logo={item.team_logo} /></td>
                <td>{item.type === "WEEKLY_RECAP" ? "Video recap" : item.description}</td>
                <td>{item.penalty_units || "—"}</td>
                <td>{obligationDueLabel(item)}</td>
                <td><StatusPill item={item} /></td>
              </tr>
            )) : <tr><td colSpan={6}>No history yet. Run your first ESPN sync from the Commissioner page.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
