import { NextResponse } from "next/server";
import { adminCookieName, adminCookieValue, validateAdminPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const data = await request.formData();
  const password = String(data.get("password") ?? "");
  if (!validateAdminPassword(password)) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(adminCookieName, adminCookieValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}
