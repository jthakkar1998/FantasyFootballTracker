import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createRecapSubmissionToken } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });

  const data = await request.formData();
  const id = String(data.get("id") ?? "");
  if (!id) return new Response("Missing obligation id", { status: 400 });

  try {
    const token = await createRecapSubmissionToken(id);
    const uploadUrl = new URL(`/submit/${token}`, request.url).toString();
    const redirectUrl = new URL("/admin", request.url);
    redirectUrl.searchParams.set("uploadLink", uploadUrl);
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    const redirectUrl = new URL("/admin", request.url);
    redirectUrl.searchParams.set("error", error instanceof Error ? error.message : "Could not create upload link");
    return NextResponse.redirect(redirectUrl, 303);
  }
}
