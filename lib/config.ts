export const leagueConfig = {
  leagueId: Number(process.env.ESPN_LEAGUE_ID ?? "666066604"),
  season: Number(process.env.ESPN_SEASON ?? "2026"),
  timeZone: process.env.LEAGUE_TIME_ZONE ?? "America/New_York",
  benchSlotIds: new Set([20, 21]),
  // ESPN's standard football lineup-slot labels. Unknown custom IDs still work;
  // they simply render as "Slot <id>".
  slotLabels: {
    0: "QB",
    1: "TQB",
    2: "RB",
    3: "RB/WR",
    4: "WR",
    5: "WR/TE",
    6: "TE",
    7: "OP",
    8: "DT",
    9: "DE",
    10: "LB",
    11: "DL",
    12: "CB",
    13: "S",
    14: "DB",
    15: "DP",
    16: "D/ST",
    17: "K",
    18: "P",
    19: "HC",
    20: "Bench",
    21: "IR",
    23: "FLEX",
    24: "ER",
    25: "Rookie"
  } as Record<number, string>
};

export function slotLabel(slotId: number): string {
  return leagueConfig.slotLabels[slotId] ?? `Slot ${slotId}`;
}
