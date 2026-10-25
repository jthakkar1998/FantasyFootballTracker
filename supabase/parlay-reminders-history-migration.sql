-- Run ONCE in the existing Supabase SQL Editor. Does not remove or replace existing bets.
alter table public.parlay_submissions
  add column if not exists submitted_by_name text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists result_status text not null default 'pending',
  add column if not exists graded_at timestamptz;

do $$ begin
  alter table public.parlay_submissions
    add constraint parlay_result_status_check
    check (result_status in ('pending', 'hit', 'miss', 'push', 'void'));
exception when duplicate_object then null;
end $$;

create table if not exists public.parlay_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  team_id integer not null,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists parlay_push_subscriptions_team_idx
  on public.parlay_push_subscriptions(team_id);

create table if not exists public.parlay_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  team_id integer not null,
  subscription_id uuid not null references public.parlay_push_subscriptions(id) on delete cascade,
  reminder_slot text not null,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'attempting',
  unique (season, week, subscription_id, reminder_slot)
);
create index if not exists parlay_reminder_deliveries_week_idx
  on public.parlay_reminder_deliveries(season desc, week desc);

alter table public.parlay_push_subscriptions enable row level security;
alter table public.parlay_reminder_deliveries enable row level security;
revoke all on table public.parlay_push_subscriptions from anon, authenticated;
revoke all on table public.parlay_reminder_deliveries from anon, authenticated;
