-- Separate tables for the weekly group-parlay feature.
-- This migration does not modify the punishment obligations or recap-video tables.

create table if not exists public.parlay_submissions (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null check (week > 0),
  team_id integer not null,
  team_name text not null,
  opponent_team_id integer not null,
  opponent_team_name text not null,
  espn_player_id integer not null,
  player_name text not null,
  player_position text,
  sportsbook_player_id text not null,
  event_id text not null,
  event_starts_at timestamptz not null,
  market_id text not null,
  market_name text not null,
  stat_id text not null,
  side_id text not null,
  line text,
  odds text not null,
  bookmaker text not null default 'fanduel',
  eligibility_at_lock boolean,
  eligibility_reason text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, week, team_id)
);

create index if not exists parlay_submissions_week_idx
  on public.parlay_submissions (season desc, week desc);

create table if not exists public.parlay_odds_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create index if not exists parlay_odds_cache_fetched_idx
  on public.parlay_odds_cache (fetched_at desc);

create table if not exists public.parlay_week_locks (
  season integer not null,
  week integer not null check (week > 0),
  deadline_at timestamptz not null,
  locked_at timestamptz not null,
  primary key (season, week)
);

alter table public.parlay_submissions enable row level security;
alter table public.parlay_odds_cache enable row level security;
alter table public.parlay_week_locks enable row level security;

-- As with obligations, all access goes through Next.js using the server-only
-- SUPABASE_SECRET_KEY. There is no direct anonymous browser access to these tables.
revoke all on table public.parlay_submissions from anon, authenticated;
revoke all on table public.parlay_odds_cache from anon, authenticated;
revoke all on table public.parlay_week_locks from anon, authenticated;
