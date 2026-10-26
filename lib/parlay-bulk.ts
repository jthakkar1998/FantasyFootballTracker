import type { ParlayCommissionerRow } from "./parlay-admin";

export type BetResult = "pending" | "hit" | "miss" | "push" | "void" | "no_bet";
export type Source = "website" | "outside" | "none";
export type EditableBet = {
  source: Source;
  details: string;
  result: BetResult;
  paid: boolean;
};
export type BetUpdate = {
  season: number;
  week: number;
  teamId: number;
  websitePickId?: string;
  outside?: boolean;
  details?: string;
  result?: BetResult;
  paymentReceived?: boolean;
};

export const rowKey = (season: number, week: number, teamId: number): string => `${season}:${week}:${teamId}`;
export const results: readonly BetResult[] = ["pending", "hit", "miss", "push", "void", "no_bet"];

// Reuse for future leaderboard calculations: only settled wins/losses are graded bets.
// Pending, push, void, and explicit no-bet rows never dilute hit rate.
export function isHitRateEligible(result: BetResult): boolean {
  return result === "hit" || result === "miss";
}

export function needsPaymentFollowUp(row: ParlayCommissionerRow, entry: EditableBet): boolean {
  return entry.result !== "no_bet" && (row.hasWebsitePick || entry.source === "outside") && !entry.paid;
}

export function initialBet(row: ParlayCommissionerRow): EditableBet {
  return {
    source: row.hasWebsitePick ? "website" : row.hasOutsidePick ? "outside" : "none",
    details: row.hasOutsidePick ? (row.tracking?.outside_bet_details ?? "") : "",
    result: row.hasWebsitePick ? (row.pick?.result_status ?? "pending")
      : (row.hasOutsidePick || row.tracking?.outside_result_status === "no_bet")
        ? (row.tracking?.outside_result_status ?? "pending") : "pending",
    paid: Boolean(row.paymentVerifiedAt)
  };
}

export function diffBet(row: ParlayCommissionerRow, before: EditableBet, after: EditableBet): BetUpdate | null {
  const changed: BetUpdate = { season: row.season, week: row.week, teamId: row.teamId };
  if (row.hasWebsitePick) {
    if (after.source !== "website") throw new Error("Website picks cannot be changed into off-app picks.");
    if (after.result === "no_bet") throw new Error("An existing website pick cannot be marked No Bet Placed.");
    if (after.result !== before.result) {
      if (!row.pick?.id) throw new Error("Missing website pick ID.");
      changed.websitePickId = row.pick.id;
      changed.result = after.result;
    }
  } else {
    if (after.source === "website") throw new Error("Cannot create a website pick in commissioner tracking.");
    if (after.result === "no_bet" && (after.source !== "none" || after.details.trim())) {
      throw new Error("No Bet Placed must have source=none and no bet details.");
    }
    if (after.source !== before.source) changed.outside = after.source === "outside";
    // A source toggle also clears stale hidden values from older records.
    if (after.details !== before.details || after.source !== before.source) changed.details = after.details;
    if (after.result !== before.result || after.source !== before.source) changed.result = after.result;
    // Explicitly reset any old off-app flag/details when marking a row No Bet Placed.
    // This changes only the selected row; payment evidence remains intact.
    if (after.result === "no_bet" && before.result !== "no_bet") {
      changed.outside = false;
      changed.details = "";
      changed.result = "no_bet";
    }
  }
  if (after.paid !== before.paid) changed.paymentReceived = after.paid;
  return Object.keys(changed).length > 3 ? changed : null;
}

export const CSV_HEADERS = ["season", "week", "team_id", "team_name", "source", "bet_details", "result", "payment_received"] as const;

function csvField(value: string): string {
  return /[,"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportBetsCsv(rows: ParlayCommissionerRow[], drafts: Record<string, EditableBet>): string {
  const body = [...rows].sort((a, b) => a.week - b.week || a.teamName.localeCompare(b.teamName));
  return [CSV_HEADERS.join(","), ...body.map(row => {
    const entry = drafts[rowKey(row.season, row.week, row.teamId)] ?? initialBet(row);
    return [String(row.season), String(row.week), String(row.teamId), row.teamName,
      entry.source, row.hasWebsitePick ? "" : entry.details,
      entry.result, entry.result === "no_bet" ? "n/a" : entry.paid ? "yes" : "no"].map(csvField).join(",");
  })].join("\r\n") + "\r\n";
}

// RFC4180-style CSV reader: supports quotes, escaped quotes, commas, and multiline fields.
export function readCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let values: string[] = [], value = "", quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else value += char;
    } else if (char === '"') {
      if (value !== "" || closedQuote) throw new Error(`Invalid CSV quoting near character ${i + 1}.`);
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      values.push(value); value = ""; closedQuote = false;
      if (char === "\r" && source[i + 1] === "\n") i++;
      if (char !== ",") {
        if (values.some(v => v !== "")) rows.push(values);
        values = [];
      }
    } else {
      if (closedQuote && char !== " " && char !== "\t") throw new Error(`Unexpected text after CSV quote near character ${i + 1}.`);
      value += char;
    }
  }
  if (quoted) throw new Error("CSV has an unmatched quotation mark.");
  values.push(value);
  if (values.some(v => v !== "")) rows.push(values);
  return rows;
}

export function importBetsCsv(csv: string, rows: ParlayCommissionerRow[], current: Record<string, EditableBet>): Record<string, EditableBet> {
  const parsed = readCsv(csv);
  if (parsed.length < 2) throw new Error("CSV is empty. Download a template and fill in its rows.");
  const headers = parsed[0].map(h => h.trim().toLowerCase());
  if (headers.length !== CSV_HEADERS.length || CSV_HEADERS.some((header, i) => headers[i] !== header)) {
    throw new Error(`CSV columns must match the downloaded template: ${CSV_HEADERS.join(", ")}.`);
  }
  const byKey = new Map(rows.map(row => [rowKey(row.season, row.week, row.teamId), row]));
  const found = new Set<string>();
  const output = { ...current };
  for (let i = 1; i < parsed.length; i++) {
    const line = i + 1;
    const parts = parsed[i];
    if (parts.length !== CSV_HEADERS.length) throw new Error(`CSV row ${line}: Expected ${CSV_HEADERS.length} columns; found ${parts.length}.`);
    const [year, week, teamId, , sourceRaw, detailsRaw, resultRaw, paidRaw] = parts;
    const season = Number(year), weekNumber = Number(week), teamNumber = Number(teamId);
    if (!/^\d{4}$/.test(year.trim()) || !/^\d+$/.test(week.trim()) || !/^\d+$/.test(teamId.trim())) {
      throw new Error(`CSV row ${line}: Season, week, and team_id must be whole numbers.`);
    }
    const key = rowKey(season, weekNumber, teamNumber);
    const row = byKey.get(key);
    if (!row) throw new Error(`CSV row ${line}: Unknown season/week/team_id (${season}/${weekNumber}/${teamNumber}). Use the current downloaded template.`);
    if (found.has(key)) throw new Error(`CSV row ${line}: Duplicate team and week.`);
    found.add(key);
    const source = sourceRaw.trim().toLowerCase();
    const result = resultRaw.trim().toLowerCase();
    const paid = paidRaw.trim().toLowerCase();
    if (!(["website", "outside", "none"] as string[]).includes(source)) throw new Error(`CSV row ${line}: source must be website, outside, or none.`);
    if (!results.includes(result as BetResult)) throw new Error(`CSV row ${line}: result must be pending, hit, miss, push, void, or no_bet.`);
    if (paid !== "yes" && paid !== "no" && !(paid === "n/a" && result === "no_bet")) {
      throw new Error(`CSV row ${line}: payment_received must be yes/no (or n/a for no_bet).`);
    }
    if (detailsRaw.length > 400) throw new Error(`CSV row ${line}: bet_details exceeds 400 characters.`);
    if (row.hasWebsitePick && source !== "website") throw new Error(`CSV row ${line}: A website-submitted pick must retain source=website.`);
    if (row.hasWebsitePick && result === "no_bet") throw new Error(`CSV row ${line}: An existing website pick cannot have result=no_bet.`);
    if (!row.hasWebsitePick && source === "website") throw new Error(`CSV row ${line}: No website pick exists; choose outside or none.`);
    if (result === "no_bet" && (source !== "none" || detailsRaw.trim())) {
      throw new Error(`CSV row ${line}: result=no_bet requires source=none and blank bet_details.`);
    }
    if (source === "none" && (detailsRaw.trim() || (result !== "pending" && result !== "no_bet"))) {
      throw new Error(`CSV row ${line}: Enter source=outside to record bet details or a graded result.`);
    }
    output[key] = {
      source: source as Source,
      details: row.hasWebsitePick ? (current[key]?.details ?? "") : detailsRaw.trim(),
      result: result as BetResult,
      // "n/a" means keep any prior verification unchanged, not overwrite it.
      paid: paid === "n/a" ? (current[key]?.paid ?? false) : paid === "yes"
    };
  }
  return output;
}
