import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("scheduled reminder workflow uses real GitHub secrets expressions", () => {
  const yaml = read(".github/workflows/parlay-reminders.yml");
  assert.match(yaml, /REMINDER_URL:\s*\$\{\{\s*secrets\.PARLAY_REMINDER_URL\s*\}\}/);
  assert.match(yaml, /CRON_TOKEN:\s*\$\{\{\s*secrets\.CRON_SECRET\s*\}\}/);
  assert.doesNotMatch(yaml, /&#12[35];/);
  assert.match(yaml, /--fail-with-body/);
});

test("returning phone checks persisted Supabase team registration", () => {
  const component = read("components/ParlayNotifications.tsx");
  const route = read("app/api/parlay/notifications/route.ts");
  assert.match(component, /getSubscription\(\)/);
  assert.match(component, /action:\s*"status"/);
  assert.match(component, /registeredTeamId/);
  assert.match(route, /body\.action === "status"/);
  assert.match(route, /\.eq\("endpoint",\s*subscription\.endpoint\)/);
});

test("missing-pick reminders ignore commissioner-recorded off-app picks", () => {
  const logic = read("lib/parlay-notifications.ts");
  assert.match(logic, /parlay_weekly_team_tracking/);
  assert.match(logic, /submitted_outside_app/);
});
