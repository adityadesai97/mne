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
-- original stock-oriented numeric(12,4) / numeric(12,6) columns.
alter table public.tickers alter column current_price type numeric(18,8);
alter table public.tickers alter column previous_close type numeric(18,8);
alter table public.ticker_price_history alter column price type numeric(18,8);
alter table public.transactions alter column count type numeric(20,8);
alter table public.transactions alter column cost_price type numeric(18,8);

-- Optional CoinGecko Demo key. Crypto pricing works keyless but is
-- rate-limited far harder; a key lifts the cap and is what the hourly
-- check-prices edge function uses.
alter table public.user_settings
  add column if not exists coingecko_api_key text;
