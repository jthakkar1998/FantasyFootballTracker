create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  season integer not null,
  week integer not null check (week > 0),
  team_id integer not null,
  team_name text not null,
  team_logo text,
  type text not null check (type in ('WEEKLY_RECAP', 'ZERO_SCORE', 'NEGATIVE_SCORE', 'EMPTY_SLOT')),
  description text not null,
  player_id integer,
  player_name text,
  fantasy_points double precision,
  penalty_units integer not null default 0 check (penalty_units >= 0),
  due_at timestamptz,
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obligation_due_shape check (
    (type = 'WEEKLY_RECAP' and due_at is not null)
    or
    (type <> 'WEEKLY_RECAP' and due_date is not null)
  )
);

create index if not exists obligations_week_idx
  on public.obligations (season desc, week desc);

create index if not exists obligations_open_idx
  on public.obligations (completed, season, week);

-- The browser never talks directly to Supabase. All access goes through your
-- Next.js server using SUPABASE_SECRET_KEY, so public Data API access is denied.
alter table public.obligations enable row level security;
revoke all on table public.obligations from anon, authenticated;
