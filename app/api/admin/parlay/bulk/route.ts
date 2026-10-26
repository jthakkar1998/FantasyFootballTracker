import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { getDb } from "@/lib/supabase";
import { updateParlayAdminStatus } from "@/lib/parlay-db";
import { updateParlayWeeklyTeamTrackingFields } from "@/lib/parlay-tracking-db";
import { rowKey, results, type BetUpdate } from "@/lib/parlay-bulk";

const outcomeValues: readonly string[] = results;
function validate(input: unknown): BetUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid update format.");
  const row = input as Record<string, unknown>;
  if (row.season !== leagueConfig.season ||
      !Number.isInteger(row.week) || Number(row.week) < 1 || Number(row.week) > 22 ||
      !Number.isInteger(row.teamId) || Number(row.teamId) < 1) {
    throw new Error("Invalid season, week, or team.");
  }
  for (const field of ["outside", "paymentReceived"]) {
    if (row[field] !== undefined && typeof row[field] !== "boolean") throw new Error(`Invalid ${field} value.`);
  }
  if (row.details !== undefined && (typeof row.details !== "string" || row.details.length > 400)) {
    throw new Error("Invalid bet details (maximum 400 characters).");
  }
  if (row.result !== undefined && (typeof row.result !== "string" || !outcomeValues.includes(row.result))) {
    throw new Error("Invalid bet result.");
  }
  if (row.websitePickId !== undefined &&
      (typeof row.websitePickId !== "string" || !/^[a-f0-9-]{36}$/i.test(row.websitePickId))) {
    throw new Error("Invalid website pick ID.");
  }
  if (row.websitePickId && (row.outside !== undefined || row.details !== undefined)) {
    throw new Error("Cannot change the source or details of a website pick.");
  }
  if (row.websitePickId && row.result === undefined) throw new Error("Missing website result.");
  const hasChange = ["outside", "details", "result", "paymentReceived"].some(key => row[key] !== undefined);
  if (!hasChange) throw new Error("Nothing to save.");
  return row as BetUpdate;
}

async function saveOne(row: BetUpdate): Promise<void> {
  if (row.websitePickId && row.result !== undefined) {
    const { data, error } = await getDb().from("parlay_submissions").select("id")
      .eq("id", row.websitePickId).eq("season", row.season).eq("week", row.week)
      .eq("team_id", row.teamId).is("withdrawn_at", null).maybeSingle();
    if (error) throw new Error(`Could not verify website pick: ${error.message}`);
    if (!data) throw new Error("Website pick has changed or is no longer active. Refresh and try again.");
    await updateParlayAdminStatus({ id: row.websitePickId, kind: "result", value: row.result });
  }
  const trackingFields = {
    season: row.season, week: row.week, teamId: row.teamId,
    outside: row.outside, details: row.details,
    result: row.websitePickId ? undefined : row.result,
    paymentReceived: row.paymentReceived
  };
  await updateParlayWeeklyTeamTrackingFields(trackingFields);
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let updates: BetUpdate[];
  try {
    const body = await request.json() as { updates?: unknown };
    if (!Array.isArray(body?.updates) || body.updates.length < 1 || body.updates.length > 40) {
      throw new Error("Send between 1 and 40 updated rows per request.");
    }
    updates = body.updates.map(validate);
    const unique = new Set(updates.map(row => rowKey(row.season, row.week, row.teamId)));
    if (unique.size !== updates.length) throw new Error("Duplicate week/team updates are not allowed.");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }
  const saved: string[] = [];
  const failed: { key: string; message: string }[] = [];
  // Limit simultaneous Supabase calls, return row-level errors rather than
  // pretending the whole batch succeeded on a partial database failure.
  for (let offset = 0; offset < updates.length; offset += 4) {
    await Promise.all(updates.slice(offset, offset + 4).map(async row => {
      const key = rowKey(row.season, row.week, row.teamId);
      try {
        await saveOne(row);
        saved.push(key);
      } catch (error) {
        failed.push({ key, message: error instanceof Error ? error.message : "Save failed." });
      }
    }));
  }
  return Response.json({ saved, failed }, { status: failed.length ? 207 : 200 });
}
