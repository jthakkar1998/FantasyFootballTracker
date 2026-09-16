import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { syncLeague } from "@/lib/sync";

export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });

  try {
    await syncLeague();
    return NextResponse.redirect(new URL("/admin?synced=1", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    const url = new URL("/admin", request.url);
    url.searchParams.set("error", message.slice(0, 180));
    return NextResponse.redirect(url, 303);
  }
}
