import { NextResponse } from "next/server";
import { createRecapSignedUpload, getRecapByUploadToken } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body.token ?? "");
    const contentType = String(body.contentType ?? "");
    const size = Number(body.size ?? 0);

    const recap = await getRecapByUploadToken(token);
    if (!recap) return NextResponse.json({ error: "This upload link is invalid or has already been used." }, { status: 404 });

    const signed = await createRecapSignedUpload(recap, contentType, size);
    return NextResponse.json(signed);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare upload" }, { status: 400 });
  }
}
