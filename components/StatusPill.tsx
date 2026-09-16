import { isOverdue } from "@/lib/format";
import type { Obligation } from "@/lib/types";

export function StatusPill({ item }: { item: Obligation }) {
  if (item.completed) return <span className="pill complete">Complete</span>;
  if (isOverdue(item)) return <span className="pill overdue">Overdue</span>;
  return <span className="pill pending">Pending</span>;
}
