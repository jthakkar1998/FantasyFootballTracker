import { NextResponse } from "next/server";
import { finalizeRecapUpload, getRecapByUploadToken } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token ?? "");
    const path = String(body.path ?? "");
    const originalFilename = String(body.originalFilename ?? "video");
    const size = Number(body.size ?? 0);
    const contentType = String(body.contentType ?? "");

    const recap = await getRecapByUploadToken(token);
    if (!recap) return NextResponse.json({ error: "This upload link is invalid or has already been used." }, { status: 404 });

    await finalizeRecapUpload({ recap, path, originalFilename, size, contentType });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not finish upload" }, { status: 400 });
  }
}
