import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { initialBet, diffBet } from "../lib/parlay-bulk";
import { makeParlayCommissionerRows } from "../lib/parlay-admin";
import { commissionerWritesEnabled } from "../lib/commissioner-write-guard";

function pushListener() {
  const hooks: Record<string,(event:any)=>void> = {};
  const notifications: Array<{title:string; options: Record<string,unknown>}> = [];
  const sandbox = {
    self: { addEventListener: (name:string, callback:(event:any)=>void) => { hooks[name] = callback; },
      registration: { showNotification: (title:string, options:Record<string,unknown>) => {
        notifications.push({title,options}); return Promise.resolve(); } } },
    clients: { openWindow: (url:string) => Promise.resolve(url) }
  };
  vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"), sandbox);
  return { hooks, notifications };
}

test("unique live HIT event tags retain independent notifications", async () => {
  const {hooks,notifications} = pushListener();
  const push = (tag:string) => hooks.push({ data: { json: () => ({title:"HIT",body:"test",urgent:false,tag,url:"/parlay"}) },
    waitUntil: (promise:Promise<void>) => promise });
  push("ffball-2026-12-hit:website:abc");
  push("ffball-2026-12-hit:website:def");
  assert.equal(notifications.length,2);
  assert.notEqual(notifications[0].options.tag, notifications[1].options.tag);
});

test("reminders keep legacy tag, and unsafe tags/URLs are rejected by service worker", () => {
  const { hooks, notifications } = pushListener();
  hooks.push({ data: { json: () => ({title:"Reminder",tag:"bad tag",url:"//malicious.example"}) }, waitUntil: () => {} });
  assert.equal(notifications[0].options.tag,"parlay-reminder");
  assert.equal((notifications[0].options.data as {url:string}).url,"/parlay");
});

test("Preview/local commissioner writes are disabled by default", () => {
  const previous=process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  assert.equal(commissionerWritesEnabled(),false);
  process.env.VERCEL_ENV = "production";
  assert.equal(commissionerWritesEnabled(),true);
  if(previous === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV=previous;
});

test("same team/week payment patch is valid from Home or either Parlay UI", () => {
  const rows = makeParlayCommissionerRows({season:2026,throughWeek:2,
    teams:[{teamId:1,teamName:"Test Team"}], submissions:[],
    tracking:[{ season:2026,week:2,team_id:1,submitted_outside_app:true,outside_bet_details:"Player anytime TD",
      outside_result_status:"pending",outside_graded_at:null,payment_verified_at:null,updated_at:"2026-11-22T00:00:00Z" }] });
  const entry = initialBet(rows[0]);
  assert.deepEqual(diffBet(rows[0],entry,{...entry,paid:true}),{
    season:2026,week:2,teamId:1,paymentReceived:true
  });
});

test("dedicated Commissioner pages and preview guard exist", () => {
  for(const name of ["page.tsx","parlay/page.tsx","live/page.tsx","penalties/page.tsx","tools/page.tsx"])
    assert.ok(fs.existsSync(`app/admin/${name}`), `Missing admin route ${name}`);
  for(const name of ["toggle","recap-link","sync"])
    assert.match(fs.readFileSync(`app/api/admin/${name}/route.ts`,"utf8"),/commissionerWriteBlocked/);
  assert.match(fs.readFileSync("app/api/admin/parlay/test-live-push/route.ts","utf8"),/VERCEL_ENV !== "production"/);
  assert.doesNotMatch(fs.readFileSync("app/api/admin/parlay/test-live-push/route.ts","utf8"),/mark_parlay_ticket_dead|claim_parlay_ticket_alert/);
});
