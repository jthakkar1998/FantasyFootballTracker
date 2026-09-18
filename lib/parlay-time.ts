import { leagueConfig } from "./config";

export function localDateParts(iso: string, timeZone = leagueConfig.timeZone) {
  const value = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

function offsetMinutesForDate(date: string, timeZone = leagueConfig.timeZone): number {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit"
  }).formatToParts(probe);
  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = label.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function zonedLocalToIso(date: string, hour: number, minute: number, timeZone = leagueConfig.timeZone): string {
  const [year, month, day] = date.split("-").map(Number);
  const offsetMinutes = offsetMinutesForDate(date, timeZone);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

export function parlayDeadlineIso(sundayDate: string): string {
  return zonedLocalToIso(sundayDate, 10, 30, leagueConfig.timeZone);
}

export function isSundayLocal(iso: string): boolean {
  return localDateParts(iso).weekday === "Sun";
}

export function isOnLocalDate(iso: string, date: string): boolean {
  return localDateParts(iso).date === date;
}

export function formatCentralDeadline(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: leagueConfig.timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(iso));
}
