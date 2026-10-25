import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { updateParlayAdminStatus } from "@/lib/parlay-db";

export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await request.formData();
    const id = String(data.get("id") ?? "");
    const kind = String(data.get("kind") ?? "");
    const value = String(data.get("value") ?? "");
    if (kind !== "result" && kind !== "payment") return new Response("Invalid update type", { status: 400 });
    await updateParlayAdminStatus({ id, kind, value });
    return NextResponse.redirect(new URL("/admin#parlay-management", request.url), 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Could not update pick.", { status: 400 });
  }
}
