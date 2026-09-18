# Targeted SportsGameOdds lookup fix

This patch replaces the broad NFL odds fetch with a targeted flow:

1. ESPN identifies the selected player's NFL team and exact Sunday matchup.
2. SportsGameOdds loads a lightweight NFL schedule containing only a basic game market, used only to resolve the provider eventID.
3. The selected player is resolved inside that one event (using the event's embedded player map or `/players?eventID=...` as a fallback).
4. Player props are fetched using the exact `eventID` + `playerID`, then FanDuel prices are filtered locally.

This preserves the prior market-classification fix (standard Passing TD O/U vs 1+ Passing TD yes/no; Anytime TD yes/no vs Total TD O/U).

No Supabase migration and no new Vercel environment variables are required.

If a provider request still times out, the UI error now says which stage timed out:
- `SportsGameOdds NFL event lookup timed out.`
- `SportsGameOdds player lookup timed out.`
- `SportsGameOdds exact player-prop lookup timed out.`
