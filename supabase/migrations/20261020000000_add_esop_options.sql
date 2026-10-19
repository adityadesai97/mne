-- ESOP (stock option) support: grants, exercises, and a server-snapshot guard.

-- ESOP (stock option) grants: options to buy `total_options` shares at
-- `strike_price`, vesting like an RSU grant (same cliff + cadence math) and
-- exercisable until expiry_date. They live under a stock_subtypes row with
-- subtype 'ESOP'. An exercise (esop_exercises) converts options into shares:
-- it adds a Market tax lot (transaction_id) whose cost basis the user enters.
create table if not exists public.esop_grants (
  id uuid primary key default gen_random_uuid(),
  subtype_id uuid not null references public.stock_subtypes(id) on delete cascade,
  grant_date date not null,
  total_options numeric(14,4) not null check (total_options > 0),
  strike_price numeric(18,4) not null check (strike_price >= 0),
  vest_start date not null,
  vest_end date not null,
  cliff_date date,
  vesting_frequency text not null default 'monthly'
    check (vesting_frequency in ('monthly', 'quarterly', 'annually', 'continuous')),
  expiry_date date,
  ended_at date
);

create table if not exists public.esop_exercises (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.esop_grants(id) on delete cascade,
  exercise_date date not null,
  count numeric(14,4) not null check (count > 0),
  strike_price numeric(18,4) not null,
  cost_price numeric(18,4) not null,
  transaction_id uuid references public.transactions(id) on delete set null
);

alter table public.esop_grants enable row level security;
alter table public.esop_exercises enable row level security;

drop policy if exists own_esop_grants_via_subtype on public.esop_grants;
create policy own_esop_grants_via_subtype
  on public.esop_grants
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.stock_subtypes st
      join public.assets a on a.id = st.asset_id
      where st.id = subtype_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.stock_subtypes st
      join public.assets a on a.id = st.asset_id
      where st.id = subtype_id and a.user_id = auth.uid()
    )
  );

drop policy if exists own_esop_exercises_via_grant on public.esop_exercises;
create policy own_esop_exercises_via_grant
  on public.esop_exercises
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.esop_grants g
      join public.stock_subtypes st on st.id = g.subtype_id
      join public.assets a on a.id = st.asset_id
      where g.id = grant_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.esop_grants g
      join public.stock_subtypes st on st.id = g.subtype_id
      join public.assets a on a.id = st.asset_id
      where g.id = grant_id and a.user_id = auth.uid()
    )
  );

-- Re-define the server-side snapshot job so it skips users holding options
-- (see the comment on has_options).
create or replace function public.record_net_worth_snapshots(
  p_date date default (now() at time zone 'utc')::date
) returns integer
language plpgsql security definer set search_path = public as $$
declare written integer;
begin
  with per_asset as (
    select
      a.user_id,
      a.asset_type,
      a.price,
      t.current_price,
      coalesce((
        select sum(greatest(0, tr.count - coalesce(tr.sold_at_vest, 0)))
        from public.stock_subtypes ss
        join public.transactions tr on tr.subtype_id = ss.id
        where ss.asset_id = a.id
      ), 0) as shares,
      (select count(*) from public.fixed_income_lots l where l.asset_id = a.id) as lot_count,
      coalesce((select sum(l.count * l.cost_price) from public.fixed_income_lots l where l.asset_id = a.id), 0) as lot_cost,
      a.fixed_income_subtype,
      exists (
        select 1
        from public.stock_subtypes ss
        join public.esop_grants g on g.subtype_id = ss.id
        where ss.asset_id = a.id
      ) as has_options
    from public.assets a
    left join public.tickers t on t.id = a.ticker_id
  ),
  valued as (
    select
      user_id,
      case
        when asset_type in ('Stock', 'Crypto') then
          case when current_price is null then 0 else round(current_price * shares, 2) end
        when asset_type = 'Fixed Income' and fixed_income_subtype in ('Bond', 'T-Bill') and lot_count > 0 then
          round(lot_cost, 2)
        else coalesce(price, 0)
      end as value,
      (asset_type in ('Stock', 'Crypto') and shares > 0
        and (current_price is null or current_price <= 0))
        -- Option grants add vested-intrinsic value computed from the vesting
        -- schedule in the app; the SQL job doesn't reimplement that, so it
        -- writes nothing for a user holding options rather than a total that
        -- leaves them out (the app's own snapshot on open fills the day).
        or has_options as incomplete
    from per_asset
  ),
  totals as (
    select user_id, sum(value) as total
    from valued
    group by user_id
    having not bool_or(incomplete)
  ),
  ins as (
    insert into public.net_worth_snapshots (user_id, date, value)
    select user_id, p_date, round(total, 2)
    from totals
    where total > 0
    on conflict (user_id, date) do nothing
    returning 1
  )
  select count(*) into written from ins;
  return written;
end $$;

revoke all on function public.record_net_worth_snapshots(date) from public, anon, authenticated;
grant execute on function public.record_net_worth_snapshots(date) to service_role;
