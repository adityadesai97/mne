-- Portfolio Performance Explanation moved to on-demand-only generation (no
-- more scheduled sweeps): the stored explanation is reused until either a
-- material move happens or a new market day starts. market_date records
-- which calendar day (see todayMarketDate() in portfolioExplanation.ts) the
-- stored explanation reflects, so it can be invalidated at market open.

alter table public.portfolio_explanations add column if not exists market_date date not null default current_date;
