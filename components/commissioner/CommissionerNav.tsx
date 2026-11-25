import { isAdmin } from "@/lib/auth";
import { CommissionerNavLinks } from "./CommissionerNavLinks";

/** Regular anchors deliberately cause native navigation, so existing unsaved-edit beforeunload guards work. */
export async function CommissionerNav() {
  if (!(await isAdmin())) return null; // /admin/login shares the layout
  return <header className="commissioner-header">
    <div className="commissioner-header-top">
      <div><span className="eyebrow">FFBALL DASHBOARD / COMMISSIONER</span><strong>Control Room</strong></div>
      <form action="/api/admin/logout" method="post"><button type="submit" className="button ghost">Log out</button></form>
    </div>
    <CommissionerNavLinks/>
  </header>;
}
