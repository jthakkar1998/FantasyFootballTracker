import type { ReactNode } from "react";
import { CommissionerNav } from "@/components/commissioner/CommissionerNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <><CommissionerNav />
    {process.env.VERCEL_ENV !== "production" ? <div className="commissioner-preview-banner" role="status">
      Preview/local mode — read-only. Saving commissioner data or sending test pushes is disabled to protect Production Supabase.
    </div> : null}
    {children}</>;
}
