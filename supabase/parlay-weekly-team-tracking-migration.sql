-- Commissioner-only weekly tracking for every league team, including those
-- without a parlay_submissions row. Run in Supabase SQL Editor before deploying.
-- Safe to rerun; does not delete or replace any existing submission or payment.
create table if not exists public.parlay_weekly_team_tracking (
  season integer not null,
  week integer not null check (week between 1 and 22),
  team_id integer not null,
  submitted_outside_app boolean not null default false,
  outside_bet_details text,
  outside_result_status text not null default 'pending'
    check (outside_result_status in ('pending', 'hit', 'miss', 'push', 'void')),
  outside_graded_at timestamptz,
  payment_verified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (season, week, team_id)
);

-- Preserve payments that the commissioner already marked as received.
-- This backfill is idempotent and will never unset a previously verified payment.
insert into public.parlay_weekly_team_tracking
  (season, week, team_id, payment_verified_at)
select season, week, team_id, payment_verified_at
from public.parlay_submissions
where payment_verified_at is not null
on conflict (season, week, team_id) do nothing;

create index if not exists parlay_weekly_team_tracking_week_idx
  on public.parlay_weekly_team_tracking (season desc, week desc);

alter table public.parlay_weekly_team_tracking enable row level security;
revoke all on table public.parlay_weekly_team_tracking from anon, authenticated;
-- Access occurs only server-side via the Supabase service-role client.
