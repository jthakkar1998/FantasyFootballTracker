/** A Preview may share the Production Supabase database. Treat all commissioner writes as production-only. */
export function commissionerWritesEnabled(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export function commissionerWriteBlocked(): Response | null {
  return commissionerWritesEnabled() ? null : Response.json({
    error: "Commissioner edits and push tests are disabled outside Vercel Production. Preview is read-only."
  }, { status: 403 });
}
