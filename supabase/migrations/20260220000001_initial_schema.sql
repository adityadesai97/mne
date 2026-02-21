-- Tickers (stocks, ETFs tracked for price)
create table tickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  symbol text not null,
  current_price numeric(12,4),
  last_updated date,
  unique(user_id, symbol)
);

-- Themes (AI, Technology, etc.)
create table themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  unique(user_id, name)
);

-- Ticker <-> Theme mapping
create table ticker_themes (
  ticker_id uuid references tickers on delete cascade,
  theme_id uuid references themes on delete cascade,
  primary key (ticker_id, theme_id)
);

-- Theme allocation targets
create table theme_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  theme_id uuid references themes on delete cascade,
  target_percentage numeric(5,2) not null,
  is_active boolean default true
);

-- Assets (accounts/positions)
create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  asset_type text not null,   -- 401k | CD | Cash | Deposit | HSA | Stock
  location_name text not null,
  account_type text not null, -- Investment | Checking | Savings | Misc
  ownership text not null,    -- Individual | Joint
  notes text,
  price numeric(12,4),        -- for non-stock assets
  ticker_id uuid references tickers
);

-- Stock subtypes per asset (Market / ESPP / RSU)
create table stock_subtypes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets on delete cascade,
  subtype text not null  -- Market | ESPP | RSU
);

-- Individual tax lots (transactions)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  subtype_id uuid references stock_subtypes on delete cascade,
  count numeric(12,6) not null,
  cost_price numeric(12,4) not null,
  purchase_date date not null,
  capital_gains_status text not null  -- Short Term | Long Term
);

-- RSU grants
create table rsu_grants (
  id uuid primary key default gen_random_uuid(),
  subtype_id uuid references stock_subtypes on delete cascade,
  grant_date date not null,
  first_vest_date date,
  cadence_months int,
  unvested_count int default 0
);

-- User settings
create table user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users unique not null,
  claude_api_key text,
  finnhub_api_key text,
  price_alert_threshold numeric(5,2) default 5.0,
  tax_harvest_threshold numeric(12,2) default 1000.0,
  rsu_alert_days_before int default 7
);

-- Push notification subscriptions
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null
);

-- Row Level Security
alter table tickers enable row level security;
alter table themes enable row level security;
alter table ticker_themes enable row level security;
alter table theme_targets enable row level security;
alter table assets enable row level security;
alter table stock_subtypes enable row level security;
alter table transactions enable row level security;
alter table rsu_grants enable row level security;
alter table user_settings enable row level security;
alter table push_subscriptions enable row level security;

-- RLS policies (user sees only their own data)
create policy "own data" on tickers for all using (auth.uid() = user_id);
create policy "own data" on themes for all using (auth.uid() = user_id);
create policy "own data via ticker" on ticker_themes for all
  using (exists (select 1 from tickers where tickers.id = ticker_id and tickers.user_id = auth.uid()));
create policy "own data" on theme_targets for all using (auth.uid() = user_id);
create policy "own data" on assets for all using (auth.uid() = user_id);
create policy "own data via asset" on stock_subtypes for all
  using (exists (select 1 from assets where assets.id = asset_id and assets.user_id = auth.uid()));
create policy "own data via subtype" on transactions for all
  using (exists (
    select 1 from stock_subtypes st
    join assets a on a.id = st.asset_id
    where st.id = subtype_id and a.user_id = auth.uid()
  ));
create policy "own data via subtype" on rsu_grants for all
  using (exists (
    select 1 from stock_subtypes st
    join assets a on a.id = st.asset_id
    where st.id = subtype_id and a.user_id = auth.uid()
  ));
create policy "own data" on user_settings for all using (auth.uid() = user_id);
create policy "own data" on push_subscriptions for all using (auth.uid() = user_id);
