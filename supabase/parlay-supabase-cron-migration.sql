-- PHASE A: Run in Supabase SQL Editor BEFORE deploying the corresponding code.
-- Additive migration: never deletes existing parlay picks, payments, device subscriptions,
-- or reminder deliveries. Supabase Cron (pg_cron), pg_net and Vault must be enabled.

alter table public.parlay_reminder_deliveries
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_http_status integer,
  add column if not exists last_error text;

-- Atomic delivery claim, safe against overlapping cron runs and transient failures.
-- A successful sent/expired record is never claimed again. Failed or abandoned
-- attempts may be retried up to 3 times total in the same window.
create or replace function public.claim_parlay_reminder_delivery(
  p_season integer, p_week integer, p_team_id integer,
  p_subscription_id uuid, p_slot text
) returns table(delivery_id uuid, attempts integer)
language sql security invoker set search_path = '' as $claim$
  insert into public.parlay_reminder_deliveries as d
    (season, week, team_id, subscription_id, reminder_slot, status, attempted_at, attempt_count)
  values (p_season, p_week, p_team_id, p_subscription_id, p_slot, 'attempting', now(), 1)
  on conflict (season, week, subscription_id, reminder_slot)
  do update set status = 'attempting', attempted_at = now(),
    attempt_count = d.attempt_count + 1, last_http_status = null, last_error = null
  where d.attempt_count < 3 and
    (d.status = 'failed' or
     (d.status = 'attempting' and d.attempted_at < now() - interval '2 minutes'))
  returning d.id, d.attempt_count;
$claim$;
revoke all on function public.claim_parlay_reminder_delivery(integer,integer,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_parlay_reminder_delivery(integer,integer,integer,uuid,text)
  to service_role;

create table if not exists public.parlay_reminder_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','no_window','preview','error')),
  slot text,
  missing_teams integer not null default 0,
  registered_devices integer not null default 0,
  eligible_devices integer not null default 0,
  attempted integer not null default 0,
  retried integer not null default 0,
  sent integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  error_message text
);
create index if not exists parlay_reminder_runs_started_at_idx
  on public.parlay_reminder_runs(started_at desc);
alter table public.parlay_reminder_runs enable row level security;
revoke all on public.parlay_reminder_runs from anon, authenticated;

create table if not exists public.parlay_reminder_dispatches (
  id bigint generated always as identity primary key,
  queued_at timestamptz not null default now(),
  request_id bigint not null,
  is_test boolean not null default false
);
create index if not exists parlay_reminder_dispatches_queued_at_idx
  on public.parlay_reminder_dispatches(queued_at desc);
alter table public.parlay_reminder_dispatches enable row level security;
revoke all on public.parlay_reminder_dispatches from anon, authenticated;

-- The dispatch function is private; it pulls a REMINDER-ONLY token from Vault.
-- Do not reuse your existing Vercel CRON_SECRET: it also protects ESPN sync jobs.
create schema if not exists ffball_private;
revoke all on schema ffball_private from public, anon, authenticated;

create or replace function ffball_private.ffball_enqueue_reminder(p_dry_run boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $job$
declare
  chicago_time timestamp := now() at time zone 'America/Chicago';
  weekday integer;
  minute_of_day integer;
  inside_window boolean;
  target_url text;
  target_token text;
  queued bigint;
begin
  weekday := extract(dow from chicago_time);
  minute_of_day := extract(hour from chicago_time) * 60 + extract(minute from chicago_time);
  inside_window := (
    (weekday between 4 and 6 and minute_of_day >= 1200 and minute_of_day < 1245)
    or (weekday = 0 and minute_of_day >= 540 and minute_of_day < 570)
    or (weekday = 0 and minute_of_day >= 690 and minute_of_day < 715)
  );
  if not p_dry_run and not inside_window then return null; end if;

  select decrypted_secret into target_url from vault.decrypted_secrets
    where name = 'ffball_reminder_url' limit 1;
  select decrypted_secret into target_token from vault.decrypted_secrets
    where name = 'ffball_reminder_token' limit 1;
  if target_url is null or target_token is null or target_url !~ '^https://' then
    raise exception 'Missing/invalid ffball_reminder_url or ffball_reminder_token in Supabase Vault';
  end if;
  -- This endpoint does not accept user-input URLs. Use the production Vercel domain only.
  if p_dry_run then target_url := target_url || '?dryRun=1'; end if;
  select net.http_get(
    url := target_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || target_token),
    timeout_milliseconds := 65000
  ) into queued;
  insert into public.parlay_reminder_dispatches(request_id, is_test)
    values (queued, p_dry_run);
  return queued;
end;
$job$;
revoke all on function ffball_private.ffball_enqueue_reminder(boolean) from public, anon, authenticated;

-- Run this function from Supabase SQL Editor at any time, even outside a
-- reminder window. The URL includes dryRun=1 and NEVER sends real push messages.
create or replace function ffball_private.ffball_test_reminder_connection()
returns bigint language sql security definer set search_path = '' as $test$
  select ffball_private.ffball_enqueue_reminder(true);
$test$;
revoke all on function ffball_private.ffball_test_reminder_connection() from public, anon, authenticated;

-- IMPORTANT: This file does NOT enable the schedule. Run the enable SQL
-- only AFTER the new Vercel code and dedicated secret are deployed.
