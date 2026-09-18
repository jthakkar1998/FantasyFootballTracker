# Parlay odds timeout fix

This hotfix keeps the market-classification fix and makes SportsGameOdds requests more resilient.

Changes:
- removes the explicit `includeAltLines=false` query parameter (false is already the provider default)
- reduces the primary NFL batch from 100 events to 25
- retries once with a simpler provider query when the first request fails/times out
- falls back to the last cached odds response if the provider is temporarily unavailable
- adds a 15-second request timeout instead of letting the browser spin indefinitely
- restores the `preferred` sorting variable used by the prop ordering code

No Supabase migration or Vercel environment-variable changes are required.
