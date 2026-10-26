import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { leagueConfig } from "@/lib/config";
import { updateParlayWeeklyTeamTracking } from "@/lib/parlay-tracking-db";

export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await request.formData();
    const season = Number(data.get("season"));
    const week = Number(data.get("week"));
    const teamId = Number(data.get("teamId"));
    const action = String(data.get("action") ?? "");
    const value = String(data.get("value") ?? "");
    if (season !== leagueConfig.season ||
        !["outside", "payment", "outside_result", "outside_details"].includes(action)) {
      return new Response("Invalid commissioner update.", { status: 400 });
    }
    await updateParlayWeeklyTeamTracking({
      season, week, teamId,
      action: action as "outside" | "payment" | "outside_result" | "outside_details",
      value
    });
    return NextResponse.redirect(new URL(`/admin#parlay-row-${season}-${week}-${teamId}`, request.url), 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Could not update weekly tracking.", { status: 400 });
  }
}
