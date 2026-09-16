import { leagueConfig } from "./config";
import { fetchLeagueSummary, fetchWeekBoxscore } from "./espn";
import { fetchNflWeekDeadline } from "./nfl";
import { generateWeekObligations, isWeekFinal } from "./penalties";
import { listImportedWeeks, reconcileWeekObligations } from "./supabase";

export interface SyncResult {
  leagueName: string;
  weeksChecked: number[];
  weeksImported: number[];
  generatedRows: number;
}

export async function syncLeague(): Promise<SyncResult> {
  const league = await fetchLeagueSummary();
  const currentWeek = league.status?.currentMatchupPeriod ?? league.scoringPeriodId ?? 1;
  const maxFantasyWeek = league.settings?.scheduleSettings?.matchupPeriodCount ?? currentWeek;
  const lastCandidateWeek = Math.min(currentWeek, maxFantasyWeek);

  const weeksChecked: number[] = [];
  const weeksImported: number[] = [];
  let generatedRows = 0;
  const importedWeeks = new Set(await listImportedWeeks(leagueConfig.season));

  // Backfill any missing historical week, then keep rechecking only the newest two
  // weeks so late ESPN stat corrections are reflected without re-downloading an
  // entire season every day.
  const weeksToCheck = Array.from({ length: lastCandidateWeek }, (_, i) => i + 1).filter(
    (week) => !importedWeeks.has(week) || week >= Math.max(1, currentWeek - 2)
  );

  for (const week of weeksToCheck) {
    weeksChecked.push(week);
    const boxscore = await fetchWeekBoxscore(week);

    if (!isWeekFinal(boxscore.schedule, week)) continue;

    const deadline = await fetchNflWeekDeadline(week + 1);
    const rows = generateWeekObligations({
      season: leagueConfig.season,
      week,
      league,
      boxscore,
      deadline
    });

    generatedRows += await reconcileWeekObligations(leagueConfig.season, week, rows);
    weeksImported.push(week);
  }

  return {
    leagueName: league.settings?.name ?? "Fantasy League",
    weeksChecked,
    weeksImported,
    generatedRows
  };
}
