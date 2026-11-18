import assert from "node:assert/strict";
import test from "node:test";
import { reconcileTicket, evaluateTicketLeg, hitBroadcastCopy } from "../lib/parlay-ticket-core";
import { chooseGradingSnapshot, snapshotSlotForInstant, type SnapshotPick, type SnapshotRecord } from "../lib/parlay-snapshot-core";
import { chicagoLiveHitWindow } from "../lib/parlay-live-hit-core";
import { validateOffAppInput } from "../lib/parlay-offapp-validation";
import type { ParlaySubmission } from "../lib/parlay-types";
import type { OffAppLeg } from "../lib/parlay-offapp";
import type { ParlayWeeklyTeamTracking } from "../lib/parlay-admin";

const teamIds = Array.from({ length: 10 }, (_,i)=>i+1);
const track = (team_id:number, outside=false, outcome: ParlayWeeklyTeamTracking["outside_result_status"]="pending"): ParlayWeeklyTeamTracking => ({
  season:2026, week:11, team_id, submitted_outside_app:outside, outside_bet_details:null,
  outside_result_status: outcome, outside_graded_at:null, payment_verified_at:null, updated_at:"2026-11-20T02:00:00Z"
});
const other: OffAppLeg = {
  id:"off-2", season:2026,week:11,team_id:2,team_name:"Nikhil",espn_player_id:99,pro_team_id:19,
  player_name:"Test Player",nfl_event_id:"event",event_starts_at:"2026-11-22T14:30:00Z",
  stat_id:"receiving_receptions",side_id:"over",line:"5.5",book_name:"FanDuel",confirmed:true,
  recorded_at:"2026-11-22T13:00:00Z",notes:null
};
const website = { id:"web-1",season:2026,week:11,team_id:1,team_name:"Jay",
  result_status:"pending",withdrawn_at:null,espn_player_id:8,pro_team_id:19,player_name:"Web Player",
  event_starts_at:"2026-11-22T18:00:00Z",stat_id:"receiving_receptions",side_id:"over",line:"5.5" } as ParlaySubmission;

test("off-app pick and website pick are included on one reconciled ticket",()=>{
  const tracking = teamIds.map(id=>track(id,id===2,id===1?"pending":id===2?"pending":"no_bet"));
  const r=reconcileTicket({teamIds,websitePicks:[website],offapp:[other],tracking});
  assert.equal(r.unresolved.length,0);
  assert.equal(r.legs.length,2);
  assert.equal(r.legs.find(l=>l.source==="offapp")?.line,"5.5");
  assert.equal(r.noBetCount,8);
  assert.equal(r.manualLoss,null);
});
test("an off-app pick with only free text blocks positive league-wide alerts",()=>{
  const tracking=teamIds.map(id=>track(id,id===2,id===2?"pending":id===1?"pending":"no_bet"));
  const r=reconcileTicket({teamIds,websitePicks:[website],offapp:[],tracking});
  assert.ok(r.unresolved.some(msg=>msg.includes("Team 2")));
});
test("confirmed off-app manual Miss kills ticket even with unresolved other teams",()=>{
  const tracking=teamIds.map(id=>track(id,id===2,id===2?"miss":id===1?"pending":"no_bet"));
  const r=reconcileTicket({teamIds,websitePicks:[website],offapp:[],tracking});
  assert.equal(r.manualLoss?.teamId,2);
  assert.match(r.manualLoss?.key??"",/dead:offapp/);
});
test("off-app entries made after kickoff cannot send retroactive live hits",()=>{
  const r=reconcileTicket({teamIds, websitePicks:[website], offapp:[{...other,recorded_at:"2026-11-22T15:00:00Z"}],
    tracking:teamIds.map(id=>track(id,id===2,id<=2?"pending":"no_bet"))});
  assert.equal(r.legs.find(l=>l.source==="offapp")?.allowLiveHit,false);
});
test("final miss is definite; live unders wait for game end",()=>{
  const leg={espnPlayerId:99,statId:"receiving_receptions",side:"under",line:"5.5"};
  const make=(value:number, final:boolean)=>({header:{competitions:[{status:{type:{completed:final}}}]},boxscore:{players:[{statistics:[{name:"receiving",labels:["REC"],athletes:[{athlete:{id:99},stats:[String(value)]}]}]}]}});
  assert.equal(evaluateTicketLeg(make(7,false),leg).state,"waiting");
  assert.equal(evaluateTicketLeg(make(7,true),leg).state,"miss");
  assert.equal(evaluateTicketLeg(make(4,false),leg).state,"waiting");
  assert.equal(evaluateTicketLeg(make(4,true),leg).state,"hit");
});
test("early and submitted snapshots preserved after kickoff",()=>{
  const pick={id:"x",season:2026,week:11,team_id:1,team_name:"Team",event_starts_at:"2026-11-22T14:30:00Z",
    event_id:"E",market_id:"M",sportsbook_player_id:"P",stat_id:"receiving_yards",side_id:"over"} as SnapshotPick;
  const snapshot=(slot: SnapshotRecord["snapshot_slot"],at:string,line:string)=>({
    submission_id:"x",season:2026,week:11,team_id:1,snapshot_slot:slot,event_id:"E",market_id:"M",sportsbook_player_id:"P",stat_id:"receiving_yards",
    side_id:"over",line,odds:"-110",captured_at:at,quote_updated_at:at
  });
  const early=snapshot("early","2026-11-22T14:00:00Z","75.5");
  const after=snapshot("primary","2026-11-22T17:56:00Z","88.5");
  assert.equal(chooseGradingSnapshot(pick,[early,after]).selected?.line,"75.5");
  const submission=snapshot("submission","2026-11-22T14:15:00Z","76.5");
  assert.equal(chooseGradingSnapshot(pick,[early,submission,after]).selected?.line,"76.5");
  assert.equal(snapshotSlotForInstant("2026-11-22T14:00:00Z","2026-11-22"),"early");
  assert.equal(chicagoLiveHitWindow("2026-11-22T14:14:00Z").active,false);
  assert.equal(chicagoLiveHitWindow("2026-11-22T14:15:00Z").active,true);
});
test("only confirmed valid off-app bets can enter the structured ticket",()=>{
  assert.throws(()=>validateOffAppInput({week:11,teamId:1,espnPlayerId:99,statId:"receiving_yards",sideId:"over",line:"5.5",bookName:"FanDuel",confirmed:false}));
  assert.throws(()=>validateOffAppInput({week:11,teamId:1,espnPlayerId:99,statId:"touchdowns",sideId:"no",line:"1.5",bookName:"FanDuel",confirmed:true}));
  assert.doesNotThrow(()=>validateOffAppInput({week:11,teamId:1,espnPlayerId:99,statId:"touchdowns",sideId:"yes",line:null,bookName:"FanDuel",confirmed:true}));
});
test("hit push text names the owner, prop and provisional status",()=>{
  const r=reconcileTicket({teamIds,websitePicks:[website],offapp:[other],tracking:teamIds.map(id=>track(id,id===2,id<=2?"pending":"no_bet"))});
  const copy=hitBroadcastCopy(r.legs[0],6,false);
  assert.match(copy.title,/Jay/);
  assert.match(copy.body,/provisional/i);
});

test("new database patch protects all broadcast tables and preserves prior schedules",()=>{
  const fs=require("node:fs") as typeof import("node:fs");
  const sql=fs.readFileSync("supabase/parlay-league-ticket-upgrade.sql","utf8");
  for(const table of ["parlay_offapp_legs","parlay_ticket_state","parlay_ticket_alert_deliveries"]){
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql,new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`));
  }
  assert.match(sql,/UNIQUE\(season, week, alert_key, subscription_id\)/);
  assert.match(sql,/status = 'alive'/);
  assert.match(sql,/day_of_week=0 AND \(hour_of_day>8/);
  assert.match(sql,/minute_of_day>=480 AND minute_of_day<490/);
  const early=fs.readFileSync("supabase/parlay-early-snapshot-enable.sql","utf8");
  assert.match(early,/ffball-parlay-snapshot-early/);
  assert.doesNotMatch(early,/SELECT cron\.unschedule/);
});
