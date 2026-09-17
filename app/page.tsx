import { Countdown } from "@/components/Countdown";
import { StatusPill } from "@/components/StatusPill";
import { TeamIdentity } from "@/components/TeamIdentity";
import { formatDateOnly, formatDateTime, isOverdue } from "@/lib/format";
import { leagueConfig } from "@/lib/config";
import { databaseConfigured, getPublicRecapVideoUrl, listObligations } from "@/lib/supabase";
import type { Obligation } from "@/lib/types";

export const dynamic = "force-dynamic";

function EmptySetup() {
  return (
    <section className="empty-state card">
      <span className="eyebrow">SETUP REQUIRED</span>
      <h1>The dashboard code is running.</h1>
      <p>Add your Supabase environment variables, run the included schema, then use Commissioner → Sync ESPN.</p>
    </section>
  );
}

function PenaltyCard({ item }: { item: Obligation }) {
  const unitWord = item.penalty_units === 1 ? "Ice" : "Ices";
  return (
    <article className={`penalty-card ${isOverdue(item) ? "is-overdue" : ""}`}>
      <div className="penalty-topline">
        <TeamIdentity name={item.team_name} logo={item.team_logo} />
        <StatusPill item={item} />
      </div>
      <div className="penalty-main">
        <div>
          <span className="eyebrow">WEEK {item.week}</span>
          <h3>{item.description}</h3>
          <p>Due Sunday, {formatDateOnly(item.due_date)}</p>
        </div>
        <div className="unit-badge">
          <strong>{item.penalty_units}</strong>
          <span>{unitWord}</span>
        </div>
      </div>
    </article>
  );
}

export default async function Dashboard() {
  if (!databaseConfigured()) return <EmptySetup />;

  let obligations: Obligation[] = [];
  let error: string | null = null;
  try {
    obligations = await listObligations();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load obligations";
  }

  if (error) {
    return <section className="card empty-state"><h1>Dashboard unavailable</h1><p>{error}</p></section>;
  }

  const open = obligations.filter((item) => !item.completed);
  const allRecaps = obligations.filter((item) => item.type === "WEEKLY_RECAP");
  const penalties = open.filter((item) => item.type !== "WEEKLY_RECAP");
  const latestWeek = obligations.reduce((max, item) => Math.max(max, item.week), 0);
  const latestRecapWeek = Math.max(0, ...allRecaps.map((r) => r.week));
  const latestRecaps = allRecaps.filter((item) => item.week === latestRecapWeek);

  const teamTotals = new Map<string, { name: string; logo: string | null; recaps: number; units: number }>();
  for (const item of obligations) {
    const key = String(item.team_id);
    const current = teamTotals.get(key) ?? { name: item.team_name, logo: item.team_logo, recaps: 0, units: 0 };
    if (item.type === "WEEKLY_RECAP") current.recaps += 1;
    current.units += item.penalty_units;
    teamTotals.set(key, current);
  }
  const leaderboard = [...teamTotals.values()].sort((a, b) => b.units - a.units || b.recaps - a.recaps);

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">2026 · ESPN LEAGUE {leagueConfig.leagueId}</span>
          <h1>The Punishment Board</h1>
          <p>Automatic weekly accountability. Scores and lineups come from ESPN; completion stays in the commissioner&apos;s hands.</p>
        </div>
        <div className="week-chip">Through Week {latestWeek || "—"}</div>
      </section>

      {latestRecaps.length > 0 ? (
        <section className="recap-grid">
          {latestRecaps.map((recap) => (
            <article className="recap-card" key={recap.id}>
              <div className="recap-banner">WEEK {recap.week} RECAP LOSER</div>
              <div className="recap-body">
                <div className="recap-head">
                  <TeamIdentity name={recap.team_name} logo={recap.team_logo} />
                  <StatusPill item={recap} />
                </div>
                <div className="score-row">
                  <strong>{recap.fantasy_points?.toFixed(2)}</strong>
                  <span>points</span>
                </div>
                <p>{recap.description}</p>
                {recap.video_path ? (
                  <div className="recap-video-wrap">
                    <video controls preload="metadata" playsInline src={getPublicRecapVideoUrl(recap.video_path) ?? undefined}>
                      Your browser does not support embedded video.
                    </video>
                    <a className="archive-link" href="/recaps">See all recap videos →</a>
                  </div>
                ) : (
                  <div className="deadline-box">
                    <span>VIDEO DEADLINE</span>
                    <strong>{formatDateTime(recap.due_at)}</strong>
                    {recap.due_at && !recap.completed ? <em><Countdown dueAt={recap.due_at} /></em> : null}
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="card empty-state compact">
          <span className="eyebrow">WEEKLY RECAP</span>
          <h2>No recap obligation yet.</h2>
          <p>Once a completed fantasy week is synced, the lowest scorer appears here automatically.</p>
        </section>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">OPEN ITEMS</span><h2>Current Ice penalties</h2></div>
          <span className="count-chip">{penalties.length} pending</span>
        </div>
        {penalties.length ? (
          <div className="penalty-list">{penalties.map((item) => <PenaltyCard key={item.id} item={item} />)}</div>
        ) : (
          <div className="card empty-state compact"><h3>No outstanding player or lineup penalties.</h3></div>
        )}
      </section>

      <section className="rules-strip card" aria-label="Penalty rules">
        <span><strong>0.00 starter</strong><em>1 Ice</em></span>
        <span><strong>Negative starter</strong><em>2 Ices</em></span>
        <span><strong>Empty starting slot</strong><em>3 Ices</em></span>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">SEASON TOTALS</span><h2>Ice board</h2></div></div>
        <div className="table-wrap card">
          <table>
            <thead><tr><th>Team</th><th>Recap losses</th><th>Ices owed</th></tr></thead>
            <tbody>
              {leaderboard.length ? leaderboard.map((row) => (
                <tr key={row.name}>
                  <td><TeamIdentity name={row.name} logo={row.logo} /></td>
                  <td>{row.recaps}</td>
                  <td><strong>{row.units}</strong></td>
                </tr>
              )) : <tr><td colSpan={3}>No synced history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
