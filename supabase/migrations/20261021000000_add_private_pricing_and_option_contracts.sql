-- Private-company manual pricing and exchange-traded option contracts.

-- Private companies: a Stock asset with no ticker is priced by hand. The
-- per-share value (409A / last round) and the date it was set live on the asset.
alter table public.assets add column if not exists manual_price numeric(18,4);
alter table public.assets add column if not exists manual_price_date date;

-- Exchange-traded options (calls and puts) on a Stock asset's underlying.
-- Long positions only: premium_per_share is what was paid, closed_date /
-- close_premium_per_share record a sale (or expiry/exercise) of the contracts.
create table if not exists public.option_contracts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  option_type text not null check (option_type in ('call', 'put')),
  strike_price numeric(18,4) not null check (strike_price >= 0),
  expiry_date date not null,
  contracts numeric(14,4) not null check (contracts > 0),
  multiplier numeric(10,2) not null default 100 check (multiplier > 0),
  premium_per_share numeric(18,4) not null check (premium_per_share >= 0),
  purchase_date date not null,
  closed_date date,
  close_premium_per_share numeric(18,4)
);

alter table public.option_contracts enable row level security;

drop policy if exists own_option_contracts_via_asset on public.option_contracts;
create policy own_option_contracts_via_asset
  on public.option_contracts
  for all
  to authenticated
  using (exists (select 1 from public.assets a where a.id = asset_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.assets a where a.id = asset_id and a.user_id = auth.uid()));

-- Server snapshots: price private stocks from manual_price and value open option contracts.
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
      coalesce(t.current_price, a.manual_price) as current_price,
      coalesce((
        select sum(greatest(0, tr.count - coalesce(tr.sold_at_vest, 0)))
        from public.stock_subtypes ss
        join public.transactions tr on tr.subtype_id = ss.id
        where ss.asset_id = a.id
      ), 0) as shares,
      (select count(*) from public.fixed_income_lots l where l.asset_id = a.id) as lot_count,
      coalesce((select sum(l.count * l.cost_price) from public.fixed_income_lots l where l.asset_id = a.id), 0) as lot_cost,
      a.fixed_income_subtype,
      (select count(*) from public.option_contracts c
        where c.asset_id = a.id and c.closed_date is null and c.expiry_date >= p_date) as contract_count,
      -- Intrinsic value of open, unexpired long calls/puts (no time value).
      coalesce((
        select sum(
          case when c.option_type = 'call'
            then greatest(0, coalesce(t.current_price, a.manual_price) - c.strike_price)
            else greatest(0, c.strike_price - coalesce(t.current_price, a.manual_price))
          end * c.contracts * c.multiplier)
        from public.option_contracts c
        where c.asset_id = a.id and c.closed_date is null and c.expiry_date >= p_date
      ), 0) as contract_value,
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
          case when current_price is null then 0 else round(current_price * shares, 2) + round(contract_value, 2) end
        when asset_type = 'Fixed Income' and fixed_income_subtype in ('Bond', 'T-Bill') and lot_count > 0 then
          round(lot_cost, 2)
        else coalesce(price, 0)
      end as value,
      (asset_type in ('Stock', 'Crypto') and (shares > 0 or contract_count > 0)
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
