import { commissionerWriteBlocked } from "@/lib/commissioner-write-guard";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { setObligationCompleted } from "@/lib/supabase";

export async function POST(request: Request) {
  const blocked = commissionerWriteBlocked();
  if (blocked) return blocked;
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });

  const data = await request.formData();
  const id = String(data.get("id") ?? "");
  const completed = String(data.get("completed")) === "true";
  if (!id) return new Response("Missing obligation id", { status: 400 });

  await setObligationCompleted(id, completed);
  const requestedReturn = String(data.get("returnTo") ?? "");
  const destination = requestedReturn === "/admin" || requestedReturn === "/admin/penalties"
    ? requestedReturn : "/admin/penalties";
  return NextResponse.redirect(new URL(destination, request.url), 303);
}
