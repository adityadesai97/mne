-- One row per (user, ticker, day) — a daily price snapshot per ticker,
-- mirroring net_worth_snapshots' "overwrite today's row in place" shape.
-- Backs weekly/monthly/yearly/custom-timeframe stock and sector moves in
-- the Portfolio Pulse carousel, which have no other historical price
-- source (tickers only ever stores current_price/previous_close). Like
-- net_worth_snapshots, today's row reflects whatever price was live the
-- last time it was refreshed that day, not necessarily the market close.
create table if not exists public.ticker_price_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker_id uuid not null references public.tickers(id) on delete cascade,
  date date not null,
  price numeric(12,4) not null
);
create unique index if not exists ticker_price_history_user_ticker_date_key
  on public.ticker_price_history (user_id, ticker_id, date);
create index if not exists ticker_price_history_ticker_date_idx
  on public.ticker_price_history (ticker_id, date desc);

alter table public.ticker_price_history enable row level security;

drop policy if exists own_ticker_price_history on public.ticker_price_history;
create policy own_ticker_price_history
  on public.ticker_price_history
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
