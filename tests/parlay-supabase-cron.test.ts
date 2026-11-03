import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reminderForInstant, type ReminderSlot } from "../lib/parlay-reminders";
import { zonedLocalToIso } from "../lib/parlay-time";

const enable = readFileSync("supabase/parlay-supabase-cron-enable.sql", "utf8");
const migrate = readFileSync("supabase/parlay-supabase-cron-migration.sql", "utf8");
const route = readFileSync("app/api/cron/parlay-reminders/route.ts", "utf8");
const dispatcher = readFileSync("lib/parlay-notifications.ts", "utf8");

function cronMatches(expr: string, utcDate: Date): boolean {
  const [min, hour, , , weekday] = expr.trim().split(/\s+/);
  const allowed = (expression: string, value: number) =>
    expression.split(",").some(part => part === "*" || part === String(value) ||
      (part.startsWith("*/") && value % Number(part.slice(2)) === 0));
  return allowed(min, utcDate.getUTCMinutes()) && allowed(hour, utcDate.getUTCHours()) &&
    allowed(weekday, utcDate.getUTCDay());
}

const schedule = {
  night: "*/5 1,2 * * 5,6,0",
  morning: "*/5 14,15 * * 0",
  urgent: "30,35,40,45,50 16,17 * * 0"
};

test("the Supabase cron migration uses no destructive history operation", () => {
  assert.match(migrate, /add column if not exists attempt_count/);
  assert.match(migrate, /on conflict \(season, week, subscription_id, reminder_slot\)/);
  assert.match(migrate, /d\.attempt_count < 3/);
  assert.doesNotMatch(migrate, /\b(truncate|drop table|delete from public\.parlay_)\b/i);
});

test("the scheduled jobs cover CDT and CST target windows", () => {
  const dates = ["2026-09-20", "2026-11-01", "2026-11-08"];
  const slots: { before: number; hour: number; minute: number; cron: string; slot: ReminderSlot }[] = [
    { before: 3, hour: 20, minute: 0, cron: schedule.night, slot: "thu-night" },
    { before: 2, hour: 20, minute: 0, cron: schedule.night, slot: "fri-night" },
    { before: 1, hour: 20, minute: 0, cron: schedule.night, slot: "sat-night" },
    { before: 0, hour: 9, minute: 0, cron: schedule.morning, slot: "sun-morning" },
    { before: 0, hour: 11, minute: 30, cron: schedule.urgent, slot: "sun-urgent" }
  ];
  for (const sunday of dates) {
    for (const slot of slots) {
      const date = new Date(`${sunday}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - slot.before);
      const local = date.toISOString().slice(0, 10);
      const instant = zonedLocalToIso(local, slot.hour, slot.minute, "America/Chicago");
      assert.ok(cronMatches(slot.cron, new Date(instant)), `Cron skipped ${slot.slot}: ${instant}`);
      assert.equal(reminderForInstant(instant, sunday)?.slot, slot.slot);
    }
  }
  assert.match(enable, /\*\/5 1,2 \* \* 5,6,0/);
  assert.match(enable, /\*\/5 14,15 \* \* 0/);
  assert.match(enable, /30,35,40,45,50 16,17 \* \* 0/);
});

test("the Sunday urgent window never includes the 11:55 AM CT deadline", () => {
  for (const sunday of ["2026-09-20", "2026-11-01", "2026-11-08"]) {
    assert.equal(reminderForInstant(zonedLocalToIso(sunday, 11, 50, "America/Chicago"), sunday)?.slot, "sun-urgent");
    assert.equal(reminderForInstant(zonedLocalToIso(sunday, 11, 55, "America/Chicago"), sunday), null);
  }
});

test("dedicated token isolates the reminder route from other Vercel cron endpoints", () => {
  assert.match(route, /process\.env\.PARLAY_REMINDER_CRON_SECRET/);
  assert.doesNotMatch(route, /process\.env\.CRON_SECRET/);
  assert.match(migrate, /ffball_reminder_token/);
});

test("dry run never sends a push or claims a notification", () => {
  const dryRunBody = dispatcher.slice(dispatcher.indexOf('if (options.dryRun)'), dispatcher.indexOf('// An atomic Postgres claim'));
  assert.match(dryRunBody, /dryRun: true/);
  assert.doesNotMatch(dryRunBody, /sendWebPush|claim_parlay_reminder_delivery/);
  assert.match(route, /dryRun/);
  assert.match(migrate, /\?dryRun=1/);
});

test("delivery claim is unique and bounded by retry limits", () => {
  assert.match(migrate, /d\.status = 'failed'/);
  assert.match(migrate, /d\.status = 'attempting'/);
  assert.match(migrate, /interval '2 minutes'/);
  assert.match(dispatcher, /last_http_status/);
});
