-- Generalizes portfolio_explanations from one row per user to one row per
-- (user, scope, scope_key, timeframe) — the Portfolio Pulse carousel needs
-- an independent cached explanation per insight (a stock's daily move, a
-- sector's weekly move, the portfolio's yearly move, etc.), not just one
-- portfolio-wide daily story. See CLAUDE.md for the full design.

alter table public.portfolio_explanations add column if not exists scope text not null default 'portfolio';
-- Empty (not null) for scope='portfolio' — a nullable scope_key would let
-- duplicate portfolio-scope rows through, since Postgres unique indexes
-- treat NULL as distinct from itself.
alter table public.portfolio_explanations add column if not exists scope_key text not null default '';
alter table public.portfolio_explanations add column if not exists timeframe text not null default 'daily';
-- The actual day-count backing the timeframe (1/7/30/365, or an arbitrary
-- value for 'custom') — redundant with timeframe for the fixed buckets but
-- is the only thing that labels a 'custom' slot.
alter table public.portfolio_explanations add column if not exists window_days int not null default 1;

alter table public.portfolio_explanations drop constraint if exists portfolio_explanations_scope_check;
alter table public.portfolio_explanations
  add constraint portfolio_explanations_scope_check
  check (scope in ('stock', 'sector', 'portfolio'));

alter table public.portfolio_explanations drop constraint if exists portfolio_explanations_timeframe_check;
alter table public.portfolio_explanations
  add constraint portfolio_explanations_timeframe_check
  check (timeframe in ('daily', 'weekly', 'monthly', 'yearly', 'custom'));

-- Existing rows are all the single portfolio-wide daily story each user had
-- before this migration — the column defaults above already backfill them
-- correctly, nothing further to update.

drop index if exists portfolio_explanations_user_id_key;
create unique index if not exists portfolio_explanations_scope_key
  on public.portfolio_explanations (user_id, scope, scope_key, timeframe);
