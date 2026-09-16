"use client";

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Deadline passed";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function Countdown({ dueAt }: { dueAt: string }) {
  const [label, setLabel] = useState(() => formatRemaining(new Date(dueAt).getTime() - Date.now()));

  useEffect(() => {
    const update = () => setLabel(formatRemaining(new Date(dueAt).getTime() - Date.now()));
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, [dueAt]);

  return <span>{label}</span>;
}
