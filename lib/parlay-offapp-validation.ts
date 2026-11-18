export const OFFAPP_STATS = [
  "passing_yards", "passing_touchdowns", "passing_completions", "passing_attempts",
  "passing_interceptions", "rushing_yards", "rushing_attempts", "rushing_touchdowns",
  "receiving_yards", "receiving_receptions", "receiving_touchdowns",
  "receiving_longestReception", "rushing+receiving_yards", "touchdowns",
  "fieldGoals_made", "extraPoints_kicksMade", "kicking_totalPoints"
] as const;
export interface ValidatableOffAppInput {
  week: number; teamId: number; espnPlayerId: number; statId: string;
  sideId: "over" | "under" | "yes" | "no"; line: string | null;
  bookName: string; notes?: string; confirmed: boolean;
}
export function validateOffAppInput(input: ValidatableOffAppInput): void {
  if (!Number.isInteger(input.week) || input.week < 1 || input.week > 22 ||
    !Number.isInteger(input.teamId) || input.teamId < 1 ||
    !Number.isInteger(input.espnPlayerId) || input.espnPlayerId < 1 ||
    !OFFAPP_STATS.includes(input.statId as typeof OFFAPP_STATS[number]) ||
    !["over", "under", "yes", "no"].includes(input.sideId) ||
    !input.confirmed || (input.notes ?? "").length > 300 ||
    input.bookName.length < 2 || input.bookName.length > 50) throw new Error("Invalid off-app prop. Confirm the placed wager, eligible player, and market.");
  if (input.sideId === "yes" || input.sideId === "no") {
    if (input.statId !== "touchdowns" || input.line !== null) throw new Error("Yes/No is available only for anytime touchdown without a line.");
  } else if (input.line === null || !/^\d+(?:\.\d+)?$/.test(input.line) || Number(input.line) > 10000) {
    throw new Error("Over/Under requires the exact nonnegative numeric line on the placed ticket.");
  }
}
