"use client";
import { useEffect, useState } from "react";
import type { Obligation } from "@/lib/types";
import { obligationDueLabel } from "@/lib/format";

function ObligationControl({ item, writesEnabled }: { item: Obligation; writesEnabled: boolean }) {
  return <div className="commissioner-obligation" id={`obligation-${item.id}`}>
    <div><strong>{item.type === "WEEKLY_RECAP" ? "Video recap" : item.description}</strong>
      <small>Week {item.week} · Due: {obligationDueLabel(item)} · {item.completed ? "Completed" : "Outstanding"}{item.video_path ? " · Video uploaded" : ""}</small>
    </div>
    <div className="action-stack">
      {item.type === "WEEKLY_RECAP" && !item.video_path ? <form action="/api/admin/recap-link" method="post">
        <input type="hidden" name="id" value={item.id}/><button className="button ghost" type="submit" disabled={!writesEnabled}>Create upload link</button>
      </form> : null}
      <form action="/api/admin/toggle" method="post">
        <input type="hidden" name="id" value={item.id}/>
        <input type="hidden" name="completed" value={item.completed ? "false" : "true"}/>
        <input type="hidden" name="returnTo" value="/admin/penalties"/>
        <button type="submit" className={`button ${item.completed ? "ghost" : "small"}`}>{item.completed ? "Reopen" : "Mark complete"}</button>
      </form>
    </div>
  </div>;
}

export function PenaltiesBoard({ obligations, writesEnabled }: { obligations: Obligation[]; writesEnabled: boolean }) {
  const [view,setView] = useState<"team"|"type">("team");
  const [filter,setFilter] = useState<"outstanding"|"completed"|"all">("outstanding");
  useEffect(() => {
    try {
      const previous = sessionStorage.getItem("ffball-commissioner-penalties-view");
      if (previous === "team" || previous === "type") setView(previous);
    } catch { /* Keep default view. */ }
  }, []);
  const chooseView = (next: "team" | "type") => {
    setView(next);
    try { sessionStorage.setItem("ffball-commissioner-penalties-view",next); } catch { /* no-op */ }
  };
  const filtered = obligations.filter(item => filter === "all" || item.completed === (filter === "completed"));
  const group = new Map<string, Obligation[]>();
  for (const item of filtered) {
    const key = view === "team" ? item.team_name : item.type === "WEEKLY_RECAP" ? "Video recaps" : "Ice penalties";
    group.set(key, [...(group.get(key) ?? []), item]);
  }
  return <section className="commissioner-penalties-board">
    <div className="commissioner-filter-row"><div className="commissioner-view-toggle" role="group" aria-label="Group obligations">
      <button type="button" className={view === "team" ? "active" : ""} onClick={() => chooseView("team")}>By team</button>
      <button type="button" className={view === "type" ? "active" : ""} onClick={() => chooseView("type")}>By obligation</button>
    </div><label>Status <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="outstanding">Outstanding</option><option value="completed">Completed</option><option value="all">All</option>
    </select></label></div>
    {!filtered.length ? <p className="card parlay-muted">No obligations match this filter.</p> : null}
    {[...group.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,items]) => <details className="card commissioner-obligation-group" key={name} open>
      <summary><strong>{name}</strong><span>{items.length} obligation{items.length === 1 ? "" : "s"}</span></summary>
      {items.map(item => <ObligationControl key={item.id} item={item} writesEnabled={writesEnabled}/>)}
    </details>)}
  </section>;
}
