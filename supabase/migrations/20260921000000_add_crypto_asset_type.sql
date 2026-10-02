-- Crypto asset type: priced from CoinGecko instead of Finnhub.
--
-- tickers.kind distinguishes how a ticker is priced ('stock' → Finnhub,
-- 'crypto' → CoinGecko); coingecko_id is CoinGecko's own coin id (e.g.
-- 'bitcoin'), needed because ticker symbols collide across coins.
alter table public.tickers
  add column if not exists kind text not null default 'stock';
alter table public.tickers
  drop constraint if exists tickers_kind_check;
alter table public.tickers
  add constraint tickers_kind_check check (kind in ('stock', 'crypto'));
alter table public.tickers
  add column if not exists coingecko_id text;

-- Sub-cent coins and satoshi-level quantities need more precision than the
-- original stock-oriented numeric(12,4) / numeric(12,6) columns. Only columns
-- that are bounded and too small are altered; some deployed projects already
-- have these as unbounded numeric, which needs no change.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('tickers', 'current_price', 18, 8),
      ('tickers', 'previous_close', 18, 8),
      ('ticker_price_history', 'price', 18, 8),
      ('transactions', 'count', 20, 8),
      ('transactions', 'cost_price', 18, 8)
    ) as t(tbl, col, prec, scl)
  loop
    -- numeric_precision is null for an unbounded numeric column (already
    -- wide enough — constraining it would be a regression, not a widening).
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name = r.col
        and c.numeric_precision is not null
        and (c.numeric_precision < r.prec or c.numeric_scale < r.scl)
    ) then
      execute format('alter table public.%I alter column %I type numeric(%s,%s)', r.tbl, r.col, r.prec, r.scl);
    end if;
  end loop;
end $$;

-- Optional CoinGecko Demo key. Crypto pricing works keyless but is
-- rate-limited far harder; a key lifts the cap and is what the hourly
-- check-prices edge function uses.
alter table public.user_settings
  add column if not exists coingecko_api_key text;
