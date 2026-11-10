/** ESPN fantasy/ESPN NFL proTeamId -> current NFL club name and abbreviation. */
export const NFL_PRO_TEAMS: Record<number, { name: string; code: string; aliases?: string[] }> = {
  1: { name: "Atlanta Falcons", code: "ATL" },
  2: { name: "Buffalo Bills", code: "BUF" },
  3: { name: "Chicago Bears", code: "CHI" },
  4: { name: "Cincinnati Bengals", code: "CIN" },
  5: { name: "Cleveland Browns", code: "CLE" },
  6: { name: "Dallas Cowboys", code: "DAL" },
  7: { name: "Denver Broncos", code: "DEN" },
  8: { name: "Detroit Lions", code: "DET" },
  9: { name: "Green Bay Packers", code: "GB" },
  10: { name: "Tennessee Titans", code: "TEN" },
  11: { name: "Indianapolis Colts", code: "IND" },
  12: { name: "Kansas City Chiefs", code: "KC" },
  13: { name: "Las Vegas Raiders", code: "LV" },
  14: { name: "Los Angeles Rams", code: "LAR", aliases: ["LA Rams"] },
  15: { name: "Miami Dolphins", code: "MIA" },
  16: { name: "Minnesota Vikings", code: "MIN" },
  17: { name: "New England Patriots", code: "NE" },
  18: { name: "New Orleans Saints", code: "NO" },
  19: { name: "New York Giants", code: "NYG" },
  20: { name: "New York Jets", code: "NYJ" },
  21: { name: "Philadelphia Eagles", code: "PHI" },
  22: { name: "Arizona Cardinals", code: "ARI" },
  23: { name: "Pittsburgh Steelers", code: "PIT" },
  24: { name: "Los Angeles Chargers", code: "LAC", aliases: ["LA Chargers"] },
  25: { name: "San Francisco 49ers", code: "SF" },
  26: { name: "Seattle Seahawks", code: "SEA" },
  27: { name: "Tampa Bay Buccaneers", code: "TB" },
  28: { name: "Washington Commanders", code: "WSH", aliases: ["Washington"] },
  29: { name: "Carolina Panthers", code: "CAR" },
  30: { name: "Jacksonville Jaguars", code: "JAX" },
  33: { name: "Baltimore Ravens", code: "BAL" },
  34: { name: "Houston Texans", code: "HOU" }
};

export function normalizeNflTeam(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Match only a complete verified club name, an explicit alias or an exact code. */
export function matchesEspnProTeam(
  espnProTeamId: number,
  candidate: { name?: string; names?: { long?: string; medium?: string; short?: string; display?: string } } | undefined
): boolean {
  const known = NFL_PRO_TEAMS[espnProTeamId];
  if (!known || !candidate) return false;
  const allowed = new Set([known.name, known.code, ...(known.aliases ?? [])].map(normalizeNflTeam));
  const labels = [candidate.name, candidate.names?.long, candidate.names?.medium,
    candidate.names?.short, candidate.names?.display].filter((value): value is string => Boolean(value));
  return labels.some(label => allowed.has(normalizeNflTeam(label)));
}
