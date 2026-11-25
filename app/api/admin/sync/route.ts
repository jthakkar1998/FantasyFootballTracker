import { commissionerWriteBlocked } from "@/lib/commissioner-write-guard";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { syncLeague } from "@/lib/sync";

export async function POST(request: Request) {
  const blocked = commissionerWriteBlocked();
  if (blocked) return blocked;
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });

  try {
    await syncLeague();
    return NextResponse.redirect(new URL("/admin/penalties?synced=1", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    const url = new URL("/admin/penalties", request.url);
    url.searchParams.set("error", message.slice(0, 180));
    return NextResponse.redirect(url, 303);
  }
}
