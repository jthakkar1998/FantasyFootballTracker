import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "ff_admin_session";

function expectedToken(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!password || !secret) return null;
  return createHash("sha256").update(`${password}|${secret}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function adminAuthConfigured(): boolean {
  return Boolean(expectedToken());
}

export function validateAdminPassword(candidate: string): boolean {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  return Boolean(expectedPassword) && safeEqual(candidate, expectedPassword!);
}

export async function isAdmin(): Promise<boolean> {
  const token = expectedToken();
  if (!token) return false;
  const store = await cookies();
  const actual = store.get(COOKIE_NAME)?.value;
  return Boolean(actual) && safeEqual(actual!, token);
}

export function adminCookieValue(): string {
  const value = expectedToken();
  if (!value) throw new Error("Admin authentication is not configured.");
  return value;
}

export const adminCookieName = COOKIE_NAME;
