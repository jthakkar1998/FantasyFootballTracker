import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("Supabase Cron owns reminders; do not revive the legacy GitHub Actions workflow", () => {
  const sql = read("supabase/parlay-supabase-cron-enable.sql");
  for (const job of ["ffball-parlay-thu-fri-sat-night", "ffball-parlay-sunday-morning", "ffball-parlay-sunday-urgent"])
    assert.ok(sql.includes(job), `Missing Supabase Cron reminder job: ${job}`);
  assert.equal(existsSync(path.join(root, ".github/workflows/parlay-reminders.yml")), false,
    "Legacy reminder workflow must stay disabled to avoid duplicate sends.");
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
