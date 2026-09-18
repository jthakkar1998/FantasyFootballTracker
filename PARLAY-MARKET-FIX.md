# Parlay market classification fix

This patch fixes two related prop-display bugs:

- Standard QB Passing Touchdowns in the common menu now requires the `ou` (Over/Under) market, so a yes/no `1+ Passing Touchdowns` price is no longer substituted for the main 1.5-style total.
- `touchdowns` markets are now classified using `betTypeID`: `yn` is shown as **Anytime Touchdown**, while `ou` is shown as **Total Touchdowns**.

It also only displays a numeric line for true `ou` markets and explicitly requests `includeAltLines=false` from SportsGameOdds.

## Apply

From the Git-connected project root, copy this patch over the project, then run:

```bash
npm run dev
```

Verify with a QB such as Caleb Williams:

- Common props should show Passing Touchdowns as an Over/Under market (for example O/U 1.5), not a yes/no price.
- Show All Props may separately show `1+ Passing Touchdowns` if FanDuel offers it.
- `Anytime Touchdown` should be the Yes/No touchdown market.
- A touchdown O/U should instead be labeled `Total Touchdowns`.

No Supabase migration or Vercel environment-variable changes are required.
