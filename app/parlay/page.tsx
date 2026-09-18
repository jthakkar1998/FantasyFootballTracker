import { Countdown } from "@/components/Countdown";
import { ParlayBoard } from "@/components/ParlayBoard";
import { databaseConfigured } from "@/lib/supabase";
import { getCurrentParlayContext } from "@/lib/parlay";
import { ensureParlayWeekLocked, listParlaySubmissions } from "@/lib/parlay-db";
import { formatCentralDeadline } from "@/lib/parlay-time";
import { sportsOddsConfigured } from "@/lib/sports-odds";

export const dynamic = "force-dynamic";

export default async function ParlayPage() {
  if (!databaseConfigured()) {
    return <section className="card empty-state"><h1>Parlay board setup required</h1><p>Configure Supabase before using this page.</p></section>;
  }

  try {
    const context = await getCurrentParlayContext();
    if (context.locked) await ensureParlayWeekLocked(context);
    const submissions = await listParlaySubmissions(context.season, context.week);
    const deadlineMs = new Date(context.deadlineAt).getTime();
    const now = Date.now();
    const picks = submissions.map((submission) => {
      let currentEligible = true;
      let currentEligibilityReason: string | null = null;
      if (context.locked) {
        currentEligible = submission.eligibility_at_lock !== false;
        currentEligibilityReason = submission.eligibility_reason;
      } else {
        const team = context.teams.find((item) => item.teamId === submission.team_id);
        const stillStarter = Boolean(team?.eligiblePlayers.some((player) => player.espnPlayerId === submission.espn_player_id));
        const gameNotStarted = new Date(submission.event_starts_at).getTime() > now;
        currentEligible = stillStarter && gameNotStarted;
        currentEligibilityReason = !stillStarter
          ? "This player is no longer in the opponent's current starting lineup."
          : !gameNotStarted
            ? "This player's NFL game has already started."
            : null;
      }
      return { ...submission, currentEligible, currentEligibilityReason };
    });

    return (
      <>
        <section className="parlay-hero">
          <div>
            <span className="eyebrow">WEEK {context.week} · SUNDAY GROUP PARLAY</span>
            <h1>Pick Against Your Opponent</h1>
            <p>Choose one FanDuel player prop on a player currently starting for your fantasy opponent. Everyone&apos;s current pick is visible to the league.</p>
          </div>
          <div className={`parlay-deadline card ${context.locked ? "locked" : ""}`}>
            <span>{context.locked ? "PICKS LOCKED" : "PICKS LOCK"}</span>
            <strong>{formatCentralDeadline(context.deadlineAt)}</strong>
            <em>{context.locked ? "No changes or withdrawals" : <Countdown dueAt={context.deadlineAt} />}</em>
          </div>
        </section>
        <div className="parlay-rules-row">
          <span>FanDuel only</span><span>Opponent starters only</span><span>Sunday games only</span><span>1 pick per team</span>
        </div>
        <ParlayBoard context={{ ...context, locked: now >= deadlineMs }} picks={picks} oddsConfigured={sportsOddsConfigured()} />
      </>
    );
  } catch (error) {
    return (
      <section className="card empty-state">
        <span className="eyebrow">PARLAY BOARD</span>
        <h1>Parlay page unavailable</h1>
        <p>{error instanceof Error ? error.message : "Could not load the current parlay week."}</p>
      </section>
    );
  }
}
