-- Adds previous_close to tickers so the Home page can compute today's
-- movers (price change since the prior close) without a second API call.
alter table public.tickers add column if not exists previous_close numeric(12,4);
