"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ParlayPropOption, ParlaySubmission, ParlayTeamContext, ParlayWeekContext } from "@/lib/parlay-types";

type PickView = ParlaySubmission & { currentEligible: boolean; currentEligibilityReason: string | null };

function priceLabel(value: string) {
  if (!value) return "";
  return value.startsWith("-") || value.startsWith("+") ? value : Number(value) > 0 ? `+${value}` : value;
}

function sideLabel(prop: ParlayPropOption) {
  const side = prop.sideId.toLowerCase();
  if (side === "over") return `Over${prop.line ? ` ${prop.line}` : ""}`;
  if (side === "under") return `Under${prop.line ? ` ${prop.line}` : ""}`;
  if (side === "yes") return prop.line ? `Yes ${prop.line}` : "Yes";
  if (side === "no") return prop.line ? `No ${prop.line}` : "No";
  return `${prop.sideId}${prop.line ? ` ${prop.line}` : ""}`;
}

function submissionSideLabel(pick: ParlaySubmission) {
  const side = pick.side_id.toLowerCase();
  if (side === "over") return `Over${pick.line ? ` ${pick.line}` : ""}`;
  if (side === "under") return `Under${pick.line ? ` ${pick.line}` : ""}`;
  if (side === "yes") return pick.line ? `Yes ${pick.line}` : "Yes";
  if (side === "no") return pick.line ? `No ${pick.line}` : "No";
  return `${pick.side_id}${pick.line ? ` ${pick.line}` : ""}`;
}

function ctDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(iso));
}

function submittedTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

function groupProps(props: ParlayPropOption[]) {
  const groups = new Map<string, ParlayPropOption[]>();
  for (const prop of props) {
    const key = `${prop.statId}|${prop.betTypeId}|${prop.marketName}|${prop.line ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(prop);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function ParlayBoard({
  context,
  picks,
  oddsConfigured
}: {
  context: ParlayWeekContext;
  picks: PickView[];
  oddsConfigured: boolean;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [loadingPlayerId, setLoadingPlayerId] = useState<number | null>(null);
  const [propData, setPropData] = useState<{ props: ParlayPropOption[]; matchup: string; eventStartsAt: string; fetchedAt: string } | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [selectedProp, setSelectedProp] = useState<ParlayPropOption | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedTeam = context.teams.find((team) => team.teamId === teamId) ?? null;
  const currentPick = picks.find((pick) => pick.team_id === teamId) ?? null;
  const filteredPlayers = useMemo(() => {
    if (!selectedTeam) return [];
    const query = search.trim().toLowerCase();
    if (!query) return selectedTeam.eligiblePlayers;
    return selectedTeam.eligiblePlayers.filter((player) => `${player.name} ${player.position}`.toLowerCase().includes(query));
  }, [selectedTeam, search]);

  const hasFeaturedProps = Boolean(propData?.props.some((prop) => prop.isFeatured));
  const visibleProps = propData?.props.filter((prop) => showAll || !hasFeaturedProps || prop.isFeatured) ?? [];
  const propGroups = groupProps(visibleProps);

  function chooseTeam(value: string) {
    const next = value ? Number(value) : "";
    setTeamId(next);
    setSearch("");
    setPropData(null);
    setSelectedPlayerId(null);
    setSelectedProp(null);
    setMessage(null);
    setShowAll(false);
  }

  async function loadProps(espnPlayerId: number) {
    if (!selectedTeam || context.locked) return;
    setMessage(null);
    setSelectedProp(null);
    setPropData(null);
    setSelectedPlayerId(espnPlayerId);
    setLoadingPlayerId(espnPlayerId);
    try {
      const response = await fetch(`/api/parlay/props?teamId=${selectedTeam.teamId}&espnPlayerId=${espnPlayerId}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not load FanDuel props.");
      setPropData(body.data);
      setShowAll(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load FanDuel props.");
    } finally {
      setLoadingPlayerId(null);
    }
  }

  async function submitPick() {
    if (!selectedTeam || !selectedPlayerId || !selectedProp) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/parlay/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.teamId, espnPlayerId: selectedPlayerId, oddId: selectedProp.oddId, line: selectedProp.line, odds: selectedProp.odds })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not submit pick.");
      setMessage("Pick submitted. Everyone on the league page can now see it.");
      setSelectedProp(null);
      setPropData(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit pick.");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawPick() {
    if (!selectedTeam || context.locked) return;
    if (!window.confirm(`Withdraw ${selectedTeam.teamName}'s current parlay pick? You can submit another one before the deadline.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/parlay/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: selectedTeam.teamId })
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not withdraw pick.");
      setMessage("Pick withdrawn.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not withdraw pick.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="parlay-entry-grid">
        <div className="card parlay-entry-card">
          <span className="eyebrow">MAKE YOUR PICK</span>
          <h2>Choose your fantasy team</h2>
          <label className="parlay-field">
            <span>Fantasy team</span>
            <select value={teamId} onChange={(event) => chooseTeam(event.target.value)} disabled={context.locked}>
              <option value="">Select your team...</option>
              {context.teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}
            </select>
          </label>

          {selectedTeam ? (
            <>
              <div className="opponent-callout">
                <span>WEEK {context.week} OPPONENT</span>
                <strong>{selectedTeam.opponentTeamName}</strong>
                <em>Your prop must use one of their current starters playing Sunday.</em>
              </div>

              {currentPick ? (
                <div className={`current-pick-mini ${currentPick.currentEligible ? "" : "invalid"}`}>
                  <span className="eyebrow">CURRENT PICK</span>
                  <strong>{currentPick.player_name} · {submissionSideLabel(currentPick)} {currentPick.market_name}</strong>
                  <small>{priceLabel(currentPick.odds)} · {currentPick.currentEligible ? "Eligible" : currentPick.currentEligibilityReason}</small>
                  {!context.locked ? <button className="button ghost" type="button" onClick={withdrawPick} disabled={busy}>Withdraw pick</button> : null}
                </div>
              ) : null}

              {!context.locked ? (
                <>
                  <label className="parlay-field">
                    <span>Search opponent&apos;s eligible starters</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search player or position..." />
                  </label>
                  <div className="eligible-player-list">
                    {filteredPlayers.length ? filteredPlayers.map((player) => (
                      <button
                        type="button"
                        className={`eligible-player ${selectedPlayerId === player.espnPlayerId ? "selected" : ""}`}
                        key={player.espnPlayerId}
                        onClick={() => loadProps(player.espnPlayerId)}
                        disabled={!oddsConfigured || loadingPlayerId !== null}
                      >
                        <span><strong>{player.name}</strong><em>{player.position}</em></span>
                        <b>{loadingPlayerId === player.espnPlayerId ? "Loading…" : "View FanDuel props →"}</b>
                      </button>
                    )) : <p className="parlay-muted">No eligible starters match that search.</p>}
                  </div>
                  {!oddsConfigured ? <div className="notice error">FanDuel lookup is not configured yet. Add the SportsGameOdds API key to the server environment.</div> : null}
                </>
              ) : <div className="notice success">This week&apos;s selections are locked.</div>}
            </>
          ) : <p className="parlay-muted">Select your team to see the opponent and eligible players.</p>}
          {message ? <div className="notice success">{message}</div> : null}
        </div>

        <div className="card prop-browser-card">
          <div className="prop-browser-head">
            <div><span className="eyebrow">FANDUEL</span><h2>Player props</h2></div>
            {propData ? <span className="line-freshness">Lines checked {submittedTime(propData.fetchedAt)} CT</span> : null}
          </div>
          {!propData ? (
            <div className="prop-placeholder">
              <strong>Select an eligible player</strong>
              <p>Their common FanDuel props will appear here. Lines are cached for about 10 minutes to stay within the free API tier.</p>
            </div>
          ) : (
            <>
              <div className="prop-player-heading">
                <div><strong>{propData.props[0]?.playerName}</strong><span>{propData.matchup}</span></div>
                <span>{ctDateTime(propData.eventStartsAt)}</span>
              </div>
              <div className="prop-groups">
                {propGroups.map((group) => (
                  <article className="prop-market" key={`${group[0].statId}-${group[0].betTypeId}-${group[0].line ?? "none"}`}>
                    <div><strong>{group[0].marketName}</strong>{group[0].line ? <span>Line {group[0].line}</span> : null}</div>
                    <div className="prop-sides">
                      {group.map((prop) => (
                        <button
                          type="button"
                          key={prop.oddId}
                          className={`prop-side ${selectedProp?.oddId === prop.oddId ? "selected" : ""}`}
                          onClick={() => setSelectedProp(prop)}
                        >
                          <span>{sideLabel(prop)}</span><strong>{priceLabel(prop.odds)}</strong>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {hasFeaturedProps && propData.props.some((prop) => !prop.isFeatured) ? (
                <button className="button ghost show-all-props" type="button" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "Show common props only" : "Show all available props"}
                </button>
              ) : null}
              {selectedProp ? (
                <div className="pick-review">
                  <span className="eyebrow">REVIEW PICK</span>
                  <strong>{selectedProp.playerName}</strong>
                  <p>{sideLabel(selectedProp)} · {selectedProp.marketName} <b>{priceLabel(selectedProp.odds)}</b></p>
                  <button className="button primary" type="button" onClick={submitPick} disabled={busy}>{currentPick ? "Change to this pick" : "Submit this pick"}</button>
                  <small>The line and price shown here are saved exactly as displayed at submission.</small>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><span className="eyebrow">COMMUNITY BOARD</span><h2>League picks</h2></div>
          <span className="count-chip">{picks.length}/{context.teams.length} submitted</span>
        </div>
        <div className="parlay-pick-grid">
          {context.teams.map((team) => {
            const pick = picks.find((item) => item.team_id === team.teamId);
            return (
              <article className={`card league-pick-card ${pick && !pick.currentEligible ? "invalid" : ""}`} key={team.teamId}>
                <div className="league-pick-top"><strong>{team.teamName}</strong><span>vs {team.opponentTeamName}</span></div>
                {pick ? (
                  <>
                    <div className="league-pick-main"><strong>{pick.player_name}</strong><span>{pick.market_name}</span></div>
                    <div className="league-pick-line"><b>{submissionSideLabel(pick)}</b><strong>{priceLabel(pick.odds)}</strong></div>
                    <div className="league-pick-foot">
                      <span>{pick.currentEligible ? "✓ Eligible" : "⚠ Needs a new pick"}</span>
                      <em>Updated {submittedTime(pick.updated_at)} CT</em>
                    </div>
                    {!pick.currentEligible && pick.currentEligibilityReason ? <p className="invalid-reason">{pick.currentEligibilityReason}</p> : null}
                  </>
                ) : <div className="no-pick"><span>○</span><strong>No pick yet</strong></div>}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
