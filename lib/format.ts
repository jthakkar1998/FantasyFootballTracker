import { leagueConfig } from "./config";
import type { Obligation } from "./types";

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: leagueConfig.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  // Render as a calendar date without allowing server timezone to shift it.
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function obligationDueLabel(item: Obligation): string {
  return item.type === "WEEKLY_RECAP" ? formatDateTime(item.due_at) : formatDateOnly(item.due_date);
}

export function isOverdue(item: Obligation, now = new Date()): boolean {
  if (item.completed) return false;
  if (item.due_at) return now.getTime() > new Date(item.due_at).getTime();
  if (!item.due_date) return false;

  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: leagueConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const today = `${currentDate.year}-${currentDate.month}-${currentDate.day}`;
  return today > item.due_date;
}
