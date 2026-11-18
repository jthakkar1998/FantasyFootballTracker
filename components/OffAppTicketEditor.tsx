"use client";
import { useState } from "react";
import type { ParlayCommissionerRow } from "@/lib/parlay-admin";
import type { EligibleParlayPlayer } from "@/lib/parlay-types";
import type { OffAppLeg } from "@/lib/parlay-offapp";

const markets = [
  ["passing_yards", "Passing yards"], ["passing_touchdowns", "Passing TD"],
  ["passing_completions", "Completions"], ["passing_attempts", "Pass attempts"],
  ["passing_interceptions", "Interceptions"], ["rushing_yards", "Rushing yards"],
  ["rushing_attempts", "Rush attempts"], ["rushing_touchdowns", "Rushing TD"],
  ["receiving_yards", "Receiving yards"], ["receiving_receptions", "Receptions"],
  ["receiving_touchdowns", "Receiving TD"], ["receiving_longestReception", "Longest reception"],
  ["rushing+receiving_yards", "Rush + receiving yards"], ["touchdowns", "Anytime TD"],
  ["fieldGoals_made", "Field goals"], ["extraPoints_kicksMade", "Extra points"],
  ["kicking_totalPoints", "Kicker points"]
] as const;

export function OffAppTicketEditor({ row, players, existing }: {
  row: ParlayCommissionerRow; players: EligibleParlayPlayer[]; existing: OffAppLeg | null;
}) {
  const [playerId, setPlayerId] = useState(String(existing?.espn_player_id ?? players[0]?.espnPlayerId ?? ""));
  const [statId, setStatId] = useState(existing?.stat_id ?? "receiving_yards");
  const [side, setSide] = useState(existing?.side_id ?? "over");
  const [line, setLine] = useState(existing?.line ?? "");
  const [book, setBook] = useState(existing?.book_name ?? "FanDuel");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const yesNo = statId === "touchdowns";
  async function save() {
    setFeedback(""); setBusy(true);
    try {
      const response = await fetch("/api/admin/parlay/offapp-legs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: row.week, teamId: row.teamId, espnPlayerId: Number(playerId),
          statId, sideId: side, line: yesNo ? null : line.trim(), bookName: book.trim(),
          notes: notes.trim(), confirmed })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setFeedback("Saved. Refresh Commissioner to see the verified ticket status.");
      setConfirmed(false);
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save off-app leg."); }
    finally { setBusy(false); }
  }
  if (!players.length) return <div className="offapp-ticket-editor">
    <small>Structured entry is available for the current ESPN fantasy week when its opponent-starter roster is loaded.
      Existing historical off-app selections remain manual until verified.</small>
  </div>;
  return <div className="offapp-ticket-editor">
    <div className="offapp-fields">
      <label className="offapp-wide">Verified opponent starter
        <select value={playerId} onChange={e => setPlayerId(e.target.value)} disabled={busy}>
          {players.map(player => <option value={player.espnPlayerId} key={player.espnPlayerId}>{player.name} ({player.position})</option>)}
        </select>
      </label>
      <label className="offapp-wide">Prop statistic
        <select value={statId} onChange={e => {
          setStatId(e.target.value); if (e.target.value === "touchdowns") { setSide("yes"); setLine(""); }
          else if (side === "yes" || side === "no") setSide("over");
        }} disabled={busy}>
          {markets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label>Bet direction
        <select value={side} disabled={busy} onChange={e => setSide(e.target.value as "over"|"under"|"yes"|"no")}>
          {yesNo ? <><option value="yes">Yes</option><option value="no">No</option></>
            : <><option value="over">Over</option><option value="under">Under</option></>}
        </select>
      </label>
      <label>Exact placed line
        <input type="number" min="0" step="0.5" value={line} disabled={busy || yesNo}
          placeholder={yesNo ? "No line" : "75.5"} onChange={e => setLine(e.target.value)} />
      </label>
      <label>Sportsbook
        <input value={book} disabled={busy} maxLength={50} onChange={e => setBook(e.target.value)}/>
      </label>
      <label>Optional note
        <input value={notes} disabled={busy} maxLength={300} onChange={e => setNotes(e.target.value)}/>
      </label>
      <label className="offapp-wide">
        <span><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/> I verified this exact selection and line on the placed league ticket.</span>
      </label>
    </div>
    <small>For entries recorded after kickoff, final misses still count, but no retroactive live-hit alert will be sent.</small>
    <button type="button" className="button primary" disabled={busy || !confirmed || !playerId} onClick={() => void save()}>
      {busy ? "Verifying…" : "Save verified ticket leg"}
    </button>
    {feedback ? <small role="status">{feedback}</small> : null}
  </div>;
}
