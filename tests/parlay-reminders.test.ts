import assert from "node:assert/strict";
import test from "node:test";
import { parlayDeadlineIso } from "../lib/parlay-time";
import { reminderForInstant } from "../lib/parlay-reminders";

const sunday = "2026-11-08"; // Standard time (CST)
const daylightSunday = "2026-09-20"; // Daylight time (CDT)

test("Thursday reminder at 8 PM CST, but not 7 PM", () => {
  assert.equal(reminderForInstant("2026-11-06T02:00:00Z", sunday)?.slot, "thu-night");
  assert.equal(reminderForInstant("2026-11-06T01:00:00Z", sunday), null);
});
test("Friday/Saturday reminder and no duplicate Sunday morning slot before 9 AM", () => {
  assert.equal(reminderForInstant("2026-11-07T02:00:00Z", sunday)?.slot, "fri-night");
  assert.equal(reminderForInstant("2026-11-08T02:00:00Z", sunday)?.slot, "sat-night");
  assert.equal(reminderForInstant("2026-11-08T14:59:00Z", sunday), null);
  assert.equal(reminderForInstant("2026-11-08T15:00:00Z", sunday)?.slot, "sun-morning");
});
test("Sunday urgent notification is 11:30 CST, never after 11:55", () => {
  assert.deepEqual(reminderForInstant("2026-11-08T17:30:00Z", sunday), { slot: "sun-urgent", urgent: true });
  assert.equal(reminderForInstant("2026-11-08T17:55:00Z", sunday), null);
});
test("CDT (summer) reminders use earlier UTC times", () => {
  assert.equal(reminderForInstant("2026-09-18T01:00:00Z", daylightSunday)?.slot, "thu-night");
  assert.equal(reminderForInstant("2026-09-20T14:00:00Z", daylightSunday)?.slot, "sun-morning");
  assert.equal(reminderForInstant("2026-09-20T16:30:00Z", daylightSunday)?.slot, "sun-urgent");
  assert.equal(reminderForInstant("2026-09-20T16:55:00Z", daylightSunday), null);
});

test("deadline is 11:55 AM Central in CDT and CST", () => {
  assert.equal(parlayDeadlineIso("2026-09-20"), "2026-09-20T16:55:00.000Z");
  assert.equal(parlayDeadlineIso("2026-11-08"), "2026-11-08T17:55:00.000Z");
});
