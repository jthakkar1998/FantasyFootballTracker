import { localDateParts, zonedLocalToIso } from "./parlay-time";

// All reminder times are wall-clock America/Chicago, regardless of the deployment timezone.
export const PARLAY_ZONE = "America/Chicago";
export type ReminderSlot = "thu-night" | "fri-night" | "sat-night" | "sun-morning" | "sun-urgent";

export function reminderForInstant(iso: string, sundayDate: string): { slot: ReminderSlot; urgent: boolean } | null {
  const instant = new Date(iso).getTime();
  if (!Number.isFinite(instant)) return null;
  const sunday = new Date(`${sundayDate}T12:00:00Z`);
  if (!Number.isFinite(sunday.getTime())) return null;
  const dates = (daysBefore: number) => {
    const d = new Date(sunday.getTime() - daysBefore * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  const possibilities: { date: string; hour: number; minute: number; slot: ReminderSlot; maxDelay: number }[] = [
    { date: dates(3), hour: 20, minute: 0, slot: "thu-night", maxDelay: 45 },
    { date: dates(2), hour: 20, minute: 0, slot: "fri-night", maxDelay: 45 },
    { date: dates(1), hour: 20, minute: 0, slot: "sat-night", maxDelay: 45 },
    { date: sundayDate, hour: 9, minute: 0, slot: "sun-morning", maxDelay: 30 },
    { date: sundayDate, hour: 11, minute: 30, slot: "sun-urgent", maxDelay: 24 }
  ];
  const local = localDateParts(iso, PARLAY_ZONE);
  for (const option of possibilities) {
    if (local.date !== option.date) continue;
    const start = new Date(zonedLocalToIso(option.date, option.hour, option.minute, PARLAY_ZONE)).getTime();
    if (instant >= start && instant < start + option.maxDelay * 60_000) {
      return { slot: option.slot, urgent: option.slot === "sun-urgent" };
    }
  }
  return null;
}

export function reminderCopy(slot: ReminderSlot, teamName: string): { title: string; body: string } {
  if (slot === "sun-urgent") return {
    title: "URGENT: Last call for your parlay pick!",
    body: `${teamName}: No leg submitted yet. Submit your $1 parlay pick before 11:55 AM Central!`
  };
  if (slot === "sun-morning") return {
    title: "Sunday parlay reminder",
    body: `${teamName}: Your leg is still missing. Deadline is 11:55 AM Central today.`
  };
  return {
    title: "Your weekly parlay leg is missing",
    body: `${teamName}: Submit your opponent-starter prop by Sunday at 11:55 AM Central.`
  };
}
