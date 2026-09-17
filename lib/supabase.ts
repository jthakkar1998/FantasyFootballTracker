import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Obligation, ObligationInsert, RecapVideo } from "./types";

export const RECAP_BUCKET = "recap-videos";
export const MAX_RECAP_VIDEO_BYTES = 48 * 1024 * 1024;
export const ALLOWED_RECAP_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

let client: SupabaseClient | null = null;

export function databaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

function hashUploadToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function reconcileWeekObligations(
  season: number,
  week: number,
  rows: ObligationInsert[]
): Promise<number> {
  const db = getDb();

  const { data: existing, error: existingError } = await db
    .from("obligations")
    .select("id, source_key")
    .eq("season", season)
    .eq("week", week);
  if (existingError) throw new Error(`Supabase reconciliation query failed: ${existingError.message}`);

  if (rows.length) {
    // Only columns in the payload are updated on conflict, so commissioner-managed
    // completion and recap-video fields remain intact while ESPN facts can refresh.
    const { error: upsertError } = await db.from("obligations").upsert(rows, {
      onConflict: "source_key"
    });
    if (upsertError) throw new Error(`Supabase upsert failed: ${upsertError.message}`);
  }

  const liveKeys = new Set(rows.map((row) => row.source_key));
  const staleIds = (existing ?? [])
    .filter((row) => !liveKeys.has(String(row.source_key)))
    .map((row) => String(row.id));

  if (staleIds.length) {
    const { error: deleteError } = await db.from("obligations").delete().in("id", staleIds);
    if (deleteError) throw new Error(`Supabase reconciliation delete failed: ${deleteError.message}`);
  }

  return rows.length;
}

export async function listImportedWeeks(season: number): Promise<number[]> {
  const db = getDb();
  const { data, error } = await db.from("obligations").select("week").eq("season", season);
  if (error) throw new Error(`Supabase week query failed: ${error.message}`);
  return [...new Set((data ?? []).map((row) => Number(row.week)))].filter(Number.isFinite);
}

export async function listObligations(): Promise<Obligation[]> {
  const db = getDb();
  const { data, error } = await db
    .from("obligations")
    .select("*")
    .order("week", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []) as Obligation[];
}

export async function setObligationCompleted(id: string, completed: boolean): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("obligations")
    .update({
      completed,
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}

export async function createRecapSubmissionToken(id: string): Promise<string> {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashUploadToken(token);

  const { data, error } = await db
    .from("obligations")
    .update({ recap_upload_token_hash: tokenHash, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("type", "WEEKLY_RECAP")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Could not create recap upload link: ${error.message}`);
  if (!data) throw new Error("Recap obligation not found.");
  return token;
}

export async function getRecapByUploadToken(token: string): Promise<Obligation | null> {
  if (!token || token.length < 32) return null;
  const db = getDb();
  const { data, error } = await db
    .from("obligations")
    .select("*")
    .eq("type", "WEEKLY_RECAP")
    .eq("recap_upload_token_hash", hashUploadToken(token))
    .maybeSingle();

  if (error) throw new Error(`Could not validate recap upload link: ${error.message}`);
  return (data as Obligation | null) ?? null;
}

function extensionForMime(contentType: string): string {
  if (contentType === "video/mp4") return "mp4";
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  throw new Error("Unsupported video type.");
}

export async function createRecapSignedUpload(
  recap: Obligation,
  contentType: string,
  size: number
): Promise<{ path: string; token: string }> {
  if (!ALLOWED_RECAP_VIDEO_TYPES.has(contentType)) {
    throw new Error("Upload an MP4, MOV, or WebM video.");
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_RECAP_VIDEO_BYTES) {
    throw new Error("Video must be 48 MB or smaller.");
  }

  const ext = extensionForMime(contentType);
  const path = `${recap.season}/week-${String(recap.week).padStart(2, "0")}/obligation-${recap.id}/${randomUUID()}.${ext}`;
  const db = getDb();
  const { data, error } = await db.storage.from(RECAP_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) throw new Error(`Could not create signed upload URL: ${error?.message ?? "Unknown error"}`);
  return { path, token: data.token };
}

async function storageObjectExists(path: string): Promise<boolean> {
  const db = getDb();
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await db.storage.from(RECAP_BUCKET).list(folder, { search: filename, limit: 10 });
  if (error) throw new Error(`Could not verify uploaded video: ${error.message}`);
  return Boolean(data?.some((item) => item.name === filename));
}

export async function finalizeRecapUpload(args: {
  recap: Obligation;
  path: string;
  originalFilename: string;
  size: number;
  contentType: string;
}): Promise<void> {
  const { recap, path, originalFilename, size, contentType } = args;
  const expectedPrefix = `${recap.season}/week-${String(recap.week).padStart(2, "0")}/obligation-${recap.id}/`;
  if (!path.startsWith(expectedPrefix)) throw new Error("Invalid video path.");
  if (!ALLOWED_RECAP_VIDEO_TYPES.has(contentType) || size <= 0 || size > MAX_RECAP_VIDEO_BYTES) {
    throw new Error("Invalid video metadata.");
  }
  if (!(await storageObjectExists(path))) throw new Error("Uploaded video could not be found.");

  const now = new Date().toISOString();
  const db = getDb();
  const { error } = await db
    .from("obligations")
    .update({
      video_path: path,
      video_uploaded_at: now,
      video_original_filename: originalFilename.slice(0, 255),
      video_size_bytes: size,
      video_content_type: contentType,
      completed: true,
      completed_at: now,
      recap_upload_token_hash: null,
      updated_at: now
    })
    .eq("id", recap.id)
    .eq("recap_upload_token_hash", recap.recap_upload_token_hash);

  if (error) throw new Error(`Could not save recap video: ${error.message}`);
}

export function getPublicRecapVideoUrl(path: string | null): string | null {
  if (!path) return null;
  return getDb().storage.from(RECAP_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listRecapVideos(): Promise<RecapVideo[]> {
  const db = getDb();
  const { data, error } = await db
    .from("obligations")
    .select("*")
    .eq("type", "WEEKLY_RECAP")
    .not("video_path", "is", null)
    .order("week", { ascending: false });

  if (error) throw new Error(`Supabase recap query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...(row as Obligation),
    video_url: getPublicRecapVideoUrl(String(row.video_path))!
  }));
}
