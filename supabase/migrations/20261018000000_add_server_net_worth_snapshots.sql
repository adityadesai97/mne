-- Server-side daily net worth snapshots, so net_worth_snapshots rows no longer
-- depend on the app being opened. Same valuation as src/lib/portfolio.ts
-- (computeAssetValue / computeTotalNetWorth), done in SQL so there is no second
-- implementation of the math in another language.
--
--   * ticker assets (Stock, Crypto): sum over stock_subtypes -> transactions of
--     netCount (count - sold_at_vest, floored at 0) x tickers.current_price,
--     rounded to cents per asset
--   * tradable Fixed Income (Bond / T-Bill) with lots: sum(count x cost_price)
--     rounded to cents
--   * everything else (401k, Cash, HSA, CD, Deposit, a lot-less Bond): assets.price
--
-- Safety guards (mirror recordDailySnapshot / isNetWorthComplete): a user is
-- skipped, and nothing is written, when any held ticker asset (net shares > 0)
-- has a null / non-positive price, or when the total is not > 0.
--
-- Conflict rule: the app's recordDailySnapshot overwrites today's row with the
-- live value every time the app opens. This job never fights that: it only
-- fills dates that have NO row (insert ... on conflict do nothing), so a live
-- value written by the app always wins, and re-running the job is harmless.
--
-- Callable only by the service role / postgres (pg_cron). Returns rows written.

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
      a.fixed_income_subtype
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
        and (current_price is null or current_price <= 0)) as incomplete
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

-- Daily at 22:30 UTC (after the US close in both EST and EDT). pg_cron is only
-- scheduled where the extension can be had (Supabase Cloud); self-hosts without
-- it, and the PGlite tests, skip this silently. Idempotent: unschedules first.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     or exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'mne-record-net-worth-snapshots') then
      perform cron.unschedule('mne-record-net-worth-snapshots');
    end if;
    perform cron.schedule('mne-record-net-worth-snapshots', '30 22 * * *', 'select public.record_net_worth_snapshots()');
  end if;
exception when others then
  raise notice 'Skipping pg_cron schedule for net worth snapshots: %', sqlerrm;
end $$;
