import { redirect } from "next/navigation";
import { adminAuthConfigured, isAdmin } from "@/lib/auth";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const params = await searchParams;

  return (
    <section className="login-wrap">
      <form className="card login-card" action="/api/admin/login" method="post">
        <span className="eyebrow">COMMISSIONER ACCESS</span>
        <h1>Sign in</h1>
        <p>Only the commissioner can sync ESPN or mark obligations complete.</p>
        {!adminAuthConfigured() ? <div className="alert">ADMIN_PASSWORD and ADMIN_SESSION_SECRET are not configured.</div> : null}
        {params.error ? <div className="alert">Incorrect password.</div> : null}
        <label>
          Commissioner password
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        <button className="button primary" type="submit">Open commissioner controls</button>
      </form>
    </section>
  );
}
