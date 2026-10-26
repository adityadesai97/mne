-- mne self-host bootstrap schema
-- Purpose: initialize (or upgrade) a Supabase project so the current app can run locally.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Optional allowlist table (used only when VITE_RESTRICT_SIGNUPS=true)
-- is_admin=true grants access to the admin UI in Settings
create table if not exists public.allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails add column if not exists is_admin boolean not null default false;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text not null
);
create unique index if not exists locations_user_id_name_account_type_key
  on public.locations (user_id, name, account_type);

create table if not exists public.tickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  current_price numeric(12,4),
  last_updated date,
  logo text,
  watchlist_only boolean not null default false
);
create unique index if not exists tickers_user_id_symbol_key
  on public.tickers (user_id, symbol);
alter table public.tickers add column if not exists logo text;
alter table public.tickers add column if not exists watchlist_only boolean not null default false;
alter table public.tickers add column if not exists previous_close numeric(12,4);
-- How a ticker is priced: 'stock' → Finnhub, 'crypto' → CoinGecko (via coingecko_id).
alter table public.tickers add column if not exists kind text not null default 'stock';
alter table public.tickers drop constraint if exists tickers_kind_check;
alter table public.tickers add constraint tickers_kind_check check (kind in ('stock', 'crypto'));
alter table public.tickers add column if not exists coingecko_id text;

create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null
);
create unique index if not exists themes_user_id_name_key
  on public.themes (user_id, name);

create table if not exists public.ticker_themes (
  ticker_id uuid not null references public.tickers(id) on delete cascade,
  theme_id uuid not null references public.themes(id) on delete cascade,
  primary key (ticker_id, theme_id)
);

create table if not exists public.theme_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  theme_id uuid references public.themes(id) on delete cascade,
  target_percentage numeric(5,2) not null,
  is_active boolean not null default true
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  asset_type text not null,
  location_id uuid references public.locations(id),
  ownership text not null default 'Individual',
  notes text,
  price numeric(12,4),
  initial_price numeric(12,4),
  ticker_id uuid references public.tickers(id)
);

-- Compatibility columns for older schemas
alter table public.assets add column if not exists location_id uuid;
alter table public.assets add column if not exists ownership text;
alter table public.assets add column if not exists notes text;
alter table public.assets add column if not exists price numeric(12,4);
alter table public.assets add column if not exists initial_price numeric(12,4);
alter table public.assets add column if not exists ticker_id uuid;
update public.assets set ownership = 'Individual' where ownership is null;
alter table public.assets alter column ownership set default 'Individual';

-- Fixed Income super type (CD, Deposit, Bond, T-Bill subtypes) with interest
-- rate, maturity date, and face_value (the amount paid out at maturity for
-- discount instruments like T-Bills — assets.price holds what was actually
-- paid for them).
alter table public.assets add column if not exists fixed_income_subtype text;
alter table public.assets add column if not exists interest_rate numeric(6,3);
alter table public.assets add column if not exists maturity_date date;
alter table public.assets add column if not exists face_value numeric(12,4);

alter table public.assets drop constraint if exists assets_fixed_income_subtype_check;
alter table public.assets
  add constraint assets_fixed_income_subtype_check
  check (fixed_income_subtype is null or fixed_income_subtype in ('CD', 'Deposit', 'Bond', 'T-Bill'));

-- Some hosted projects carry an asset_type allowlist that predates migration
-- history. Drop and recreate it here so 'Fixed Income' is allowed and the
-- guardrail is tracked going forward; a no-op on a DB that never had it.
alter table public.assets drop constraint if exists assets_asset_type_check;

update public.assets set fixed_income_subtype = 'CD', asset_type = 'Fixed Income' where asset_type = 'CD';
update public.assets set fixed_income_subtype = 'Deposit', asset_type = 'Fixed Income' where asset_type = 'Deposit';

alter table public.assets
  add constraint assets_asset_type_check
  check (asset_type in ('Stock', 'Crypto', '401k', 'Fixed Income', 'Cash', 'HSA'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_location_id_fkey'
      and conrelid = 'public.assets'::regclass
  ) then
    alter table public.assets
      add constraint assets_location_id_fkey
      foreign key (location_id) references public.locations(id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_ticker_id_fkey'
      and conrelid = 'public.assets'::regclass
  ) then
    alter table public.assets
      add constraint assets_ticker_id_fkey
      foreign key (ticker_id) references public.tickers(id);
  end if;
end $$;

-- Backfill location_id from older location_name/account_type columns, if present
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assets' and column_name = 'location_name'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'assets' and column_name = 'account_type'
  ) then
    insert into public.locations (user_id, name, account_type)
    select distinct a.user_id, a.location_name, coalesce(a.account_type, 'Investment')
    from public.assets a
    where a.location_id is null
      and a.location_name is not null
    on conflict (user_id, name, account_type) do nothing;

    update public.assets a
    set location_id = l.id
    from public.locations l
    where a.location_id is null
      and a.user_id = l.user_id
      and a.location_name = l.name
      and coalesce(a.account_type, 'Investment') = l.account_type;
  end if;
end $$;

create table if not exists public.stock_subtypes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  subtype text not null
);
create unique index if not exists stock_subtypes_asset_id_subtype_key
  on public.stock_subtypes (asset_id, subtype);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  subtype_id uuid not null references public.stock_subtypes(id) on delete cascade,
  count numeric(12,6) not null,
  cost_price numeric(12,4) not null,
  purchase_date date not null,
  capital_gains_status text default 'Short Term'
);
alter table public.transactions add column if not exists capital_gains_status text;

create table if not exists public.rsu_grants (
  id uuid primary key default gen_random_uuid(),
  subtype_id uuid not null references public.stock_subtypes(id) on delete cascade,
  grant_date date not null,
  total_shares numeric(12,6) not null,
  vest_start date not null,
  vest_end date not null,
  cliff_date date,
  ended_at date
);

-- Compatibility columns for older RSU schema
alter table public.rsu_grants add column if not exists total_shares numeric(12,6);
alter table public.rsu_grants add column if not exists vest_start date;
alter table public.rsu_grants add column if not exists vest_end date;
alter table public.rsu_grants add column if not exists cliff_date date;
alter table public.rsu_grants add column if not exists ended_at date;

-- How a grant actually vests (cliff + equal installments at this cadence
-- through vest_end), instead of every caller guessing a smooth continuous
-- curve between vest_start and vest_end. Existing rows are backfilled to
-- 'quarterly' by the NOT NULL DEFAULT — the most common real-world
-- schedule, confirmed against an actual user's brokerage statement.
alter table public.rsu_grants add column if not exists vesting_frequency text not null default 'quarterly';
alter table public.rsu_grants drop constraint if exists rsu_grants_vesting_frequency_check;
alter table public.rsu_grants
  add constraint rsu_grants_vesting_frequency_check
  check (vesting_frequency in ('monthly', 'quarterly', 'annually', 'continuous'));

-- Link transactions to their specific RSU grant for accurate grouping
alter table public.transactions add column if not exists rsu_grant_id uuid references public.rsu_grants(id) on delete set null;
-- Shares sold at vest to cover taxes (net held = count - sold_at_vest)
alter table public.transactions add column if not exists sold_at_vest numeric(12,6) not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rsu_grants' and column_name = 'first_vest_date'
  ) then
    execute 'update public.rsu_grants set vest_start = coalesce(vest_start, first_vest_date, grant_date) where vest_start is null';
    execute 'update public.rsu_grants set vest_end = coalesce(vest_end, first_vest_date, grant_date) where vest_end is null';
  else
    update public.rsu_grants set vest_start = coalesce(vest_start, grant_date) where vest_start is null;
    update public.rsu_grants set vest_end = coalesce(vest_end, grant_date) where vest_end is null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'rsu_grants' and column_name = 'unvested_count'
  ) then
    execute 'update public.rsu_grants set total_shares = coalesce(total_shares, unvested_count, 0) where total_shares is null';
  else
    update public.rsu_grants set total_shares = coalesce(total_shares, 0) where total_shares is null;
  end if;
end $$;

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

-- Bonds and T-Bills are tradable: a Fixed Income asset of either subtype can
-- be bought in multiple lots over time (like stock tax lots), each with its
-- own quantity and cost per unit. CD/Deposit remain flat-balance accounts
-- (assets.price) since they aren't tradable positions.
create table if not exists public.fixed_income_lots (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  count numeric(14,4) not null,
  cost_price numeric(12,4) not null,
  purchase_date date not null
);

-- Plaid integration: each user brings their own free Plaid developer
-- credentials -- not one credential set shared across the deployment.
-- Secrets (the Plaid app secret, and each connected Item's access_token)
-- are never readable by the authenticated/anon roles, only by a
-- service-role edge function.
create table if not exists public.plaid_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text,
  plaid_env text not null default 'production',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- plaid_credential_secrets has no select policy by design, so the client
-- can't check directly whether a secret exists -- this tracks it instead.
alter table public.plaid_credentials add column if not exists secret_set boolean not null default false;

create table if not exists public.plaid_credential_secrets (
  user_id uuid primary key references public.plaid_credentials(user_id) on delete cascade,
  secret text not null,
  updated_at timestamptz not null default now()
);

-- Backfill for projects that saved a secret before the flag existed. Must come
-- after the secrets table is created, or a fresh database fails here.
update public.plaid_credentials
set secret_set = true
where user_id in (select user_id from public.plaid_credential_secrets) and secret_set = false;

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  created_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table if not exists public.plaid_item_secrets (
  item_id uuid primary key references public.plaid_items(id) on delete cascade,
  access_token text not null
);

create table if not exists public.plaid_pending_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  external_account_id text not null,
  external_security_id text,
  detected_type text not null check (detected_type in ('stock', 'cash', 'fixed_income', 'stock_plan')),
  payload jsonb not null,
  matched_asset_id uuid references public.assets(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.plaid_synced_positions (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  external_account_id text not null,
  external_security_id text,
  asset_id uuid references public.assets(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete cascade,
  fixed_income_lot_id uuid references public.fixed_income_lots(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists plaid_synced_positions_unique
  on public.plaid_synced_positions (plaid_item_id, external_account_id, coalesce(external_security_id, ''));

alter table public.plaid_items add column if not exists last_error text;
alter table public.plaid_items add column if not exists txn_synced_through date;

alter table public.plaid_synced_positions add column if not exists plaid_quantity numeric;
alter table public.plaid_synced_positions add column if not exists plaid_cost_price numeric;
alter table public.plaid_synced_positions add column if not exists drift_shares numeric;
alter table public.plaid_synced_positions add column if not exists checked_at timestamptz;

create table if not exists public.plaid_synced_transactions (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  investment_transaction_id text not null,
  asset_id uuid references public.assets(id) on delete set null,
  status text not null default 'applied' check (status in ('applied', 'skipped', 'needs_lots', 'resolved')),
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists plaid_synced_transactions_unique
  on public.plaid_synced_transactions (plaid_item_id, investment_transaction_id);

-- Held sells (needs_lots) keep what the user needs to pick lots by hand; the status
-- constraint is recreated so existing projects pick up the new values.
alter table public.plaid_synced_transactions add column if not exists txn_date date;
alter table public.plaid_synced_transactions add column if not exists quantity numeric;
alter table public.plaid_synced_transactions add column if not exists price numeric;
alter table public.plaid_synced_transactions add column if not exists txn_type text;
alter table public.plaid_synced_transactions drop constraint if exists plaid_synced_transactions_status_check;
alter table public.plaid_synced_transactions
  add constraint plaid_synced_transactions_status_check
  check (status in ('applied', 'skipped', 'needs_lots', 'resolved'));

-- Which tracked lot the user paired with which Plaid lot (when date/cost differ slightly).
create table if not exists public.plaid_lot_links (
  id uuid primary key default gen_random_uuid(),
  plaid_item_id uuid not null references public.plaid_items(id) on delete cascade,
  external_account_id text not null,
  external_security_id text not null,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  plaid_lot_date date not null,
  plaid_lot_price numeric not null,
  created_at timestamptz not null default now()
);
create unique index if not exists plaid_lot_links_transaction_unique
  on public.plaid_lot_links (transaction_id);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claude_api_key text,
  finnhub_api_key text,
  price_alert_threshold numeric(5,2) default 5.0,
  rsu_alert_days_before int default 7,
  auto_theme_assignment_enabled boolean not null default true,
  price_alerts_enabled boolean not null default true,
  vest_alerts_enabled boolean not null default true,
  capital_gains_alerts_enabled boolean not null default true
);
create unique index if not exists user_settings_user_id_key
  on public.user_settings (user_id);
alter table public.user_settings add column if not exists price_alert_threshold numeric(5,2) default 5.0;
alter table public.user_settings add column if not exists rsu_alert_days_before int default 7;
alter table public.user_settings add column if not exists claude_api_key text;
alter table public.user_settings add column if not exists finnhub_api_key text;
alter table public.user_settings add column if not exists auto_theme_assignment_enabled boolean not null default true;
alter table public.user_settings add column if not exists price_alerts_enabled boolean not null default true;
alter table public.user_settings add column if not exists vest_alerts_enabled boolean not null default true;
alter table public.user_settings add column if not exists capital_gains_alerts_enabled boolean not null default true;
alter table public.user_settings drop column if exists llm_provider;
alter table public.user_settings drop column if exists groq_api_key;
alter table public.user_settings add column if not exists coingecko_api_key text;
alter table public.user_settings drop column if exists tax_harvest_threshold;
alter table public.user_settings add column if not exists dashboard_layouts jsonb;
-- Was a toggle for the (now removed) background generation path; the
-- feature is on-demand only now, so there's nothing to opt in/out of.
alter table public.user_settings drop column if exists portfolio_explanation_enabled;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null
);

create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  value numeric(14,2) not null
);
create unique index if not exists net_worth_snapshots_user_id_date_key
  on public.net_worth_snapshots (user_id, date);

-- One row per (user, ticker, day) — backs weekly/monthly/yearly/custom
-- timeframe stock and sector moves in the Portfolio Pulse carousel.
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

-- Feedback on individual command bar agent responses. Attachment is stored
-- inline as base64 (small user-supplied files, e.g. a screenshot) rather
-- than requiring a Supabase Storage bucket for self-hosters.
create table if not exists public.command_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_query text,
  agent_response text not null,
  feedback_text text,
  attachment_filename text,
  attachment_mime_type text,
  attachment_content text,
  created_at timestamptz not null default now()
);
alter table public.command_feedback add column if not exists input_tokens int;
alter table public.command_feedback add column if not exists output_tokens int;
alter table public.command_feedback add column if not exists conversation_origin text not null default 'command_bar';
alter table public.command_feedback add column if not exists addressed_at timestamptz;
alter table public.command_feedback add column if not exists fix_commit text;

-- Command bar conversation history. `messages` is a JSONB array of
-- {role, content} — the same shape threaded through runCommand's history —
-- read/written as a whole, so no child table is needed.
create table if not exists public.command_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists command_conversations_user_updated_idx
  on public.command_conversations (user_id, updated_at desc);
alter table public.command_conversations add column if not exists total_input_tokens int not null default 0;
alter table public.command_conversations add column if not exists total_output_tokens int not null default 0;
-- Which surface started the conversation ('command_bar' | 'portfolio_explanation')
-- — set once at creation and never changed; see CLAUDE.md.
alter table public.command_conversations add column if not exists origin text not null default 'command_bar';

-- Portfolio Performance Explanation: a toggleable, LLM-generated summary of
-- why the user's portfolio moved. See CLAUDE.md for the full design.
create table if not exists public.portfolio_explanations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  has_major_moves boolean not null default false,
  day_change_dollars numeric(14,2),
  day_change_percent numeric(8,4),
  basis_net_worth numeric(14,2),
  movers jsonb not null default '[]'::jsonb,
  is_broad_market_move boolean not null default false,
  market_headlines jsonb not null default '[]'::jsonb,
  theme_moves jsonb not null default '[]'::jsonb,
  trigger text not null,
  input_tokens int,
  output_tokens int,
  generated_at timestamptz not null default now()
);
create unique index if not exists portfolio_explanations_user_id_key
  on public.portfolio_explanations (user_id);
-- Generation is on-demand only (see CLAUDE.md) — reused until a material
-- move happens or a new market day starts, tracked by this column.
alter table public.portfolio_explanations add column if not exists market_date date not null default current_date;

-- One row per (user, scope, scope_key, timeframe) — the Portfolio Pulse
-- carousel caches an independent explanation per insight (a stock's daily
-- move, a sector's weekly move, the portfolio's yearly move, etc.).
alter table public.portfolio_explanations add column if not exists scope text not null default 'portfolio';
alter table public.portfolio_explanations add column if not exists scope_key text not null default '';
alter table public.portfolio_explanations add column if not exists timeframe text not null default 'daily';
alter table public.portfolio_explanations add column if not exists window_days int not null default 1;

alter table public.portfolio_explanations drop constraint if exists portfolio_explanations_scope_check;
alter table public.portfolio_explanations
  add constraint portfolio_explanations_scope_check
  check (scope in ('stock', 'sector', 'portfolio'));

alter table public.portfolio_explanations drop constraint if exists portfolio_explanations_timeframe_check;
alter table public.portfolio_explanations
  add constraint portfolio_explanations_timeframe_check
  check (timeframe in ('daily', 'weekly', 'monthly', 'yearly', 'custom'));

drop index if exists portfolio_explanations_user_id_key;
create unique index if not exists portfolio_explanations_scope_key
  on public.portfolio_explanations (user_id, scope, scope_key, timeframe);

-- Append-only usage ledger shared by portfolio explanations + the command
-- bar. Each feature also denormalizes its own latest/running totals above
-- for cheap inline display without querying this table.
create table if not exists public.llm_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  conversation_id uuid references public.command_conversations(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists llm_usage_log_user_feature_created_idx
  on public.llm_usage_log (user_id, feature, created_at desc);

-- RLS
alter table public.allowed_emails enable row level security;
alter table if exists public.admin_users enable row level security;
alter table public.locations enable row level security;
alter table public.tickers enable row level security;
alter table public.themes enable row level security;
alter table public.ticker_themes enable row level security;
alter table public.theme_targets enable row level security;
alter table public.assets enable row level security;
alter table public.stock_subtypes enable row level security;
alter table public.transactions enable row level security;
alter table public.rsu_grants enable row level security;
alter table public.esop_grants enable row level security;
alter table public.esop_exercises enable row level security;
alter table public.option_contracts enable row level security;
alter table public.fixed_income_lots enable row level security;
alter table public.plaid_credentials enable row level security;
alter table public.plaid_credential_secrets enable row level security;
alter table public.plaid_items enable row level security;
alter table public.plaid_item_secrets enable row level security;
alter table public.plaid_pending_positions enable row level security;
alter table public.plaid_synced_positions enable row level security;
alter table public.plaid_synced_transactions enable row level security;
alter table public.plaid_lot_links enable row level security;
alter table public.user_settings enable row level security;
-- Crypto needs sub-cent prices and satoshi-level quantities; widen the
-- original stock-oriented numeric precision (no-op when already widened).
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

alter table public.push_subscriptions enable row level security;
alter table public.net_worth_snapshots enable row level security;
alter table public.ticker_price_history enable row level security;
alter table public.command_feedback enable row level security;
alter table public.command_conversations enable row level security;
alter table public.portfolio_explanations enable row level security;
alter table public.llm_usage_log enable row level security;

drop policy if exists allowlist_self_read on public.allowed_emails;
create policy allowlist_self_read
  on public.allowed_emails
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Helper function used by RLS to check admin status without self-referential recursion
create or replace function public.is_allowed_email_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and is_admin = true
  )
$$;

drop policy if exists allowlist_admin_manage on public.allowed_emails;
create policy allowlist_admin_manage
  on public.allowed_emails
  for all
  to authenticated
  using (public.is_allowed_email_admin())
  with check (public.is_allowed_email_admin());

drop policy if exists own_locations on public.locations;
create policy own_locations
  on public.locations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_tickers on public.tickers;
create policy own_tickers
  on public.tickers
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_themes on public.themes;
create policy own_themes
  on public.themes
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_ticker_themes_via_ticker on public.ticker_themes;
create policy own_ticker_themes_via_ticker
  on public.ticker_themes
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.tickers t
      where t.id = ticker_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tickers t
      where t.id = ticker_id and t.user_id = auth.uid()
    )
  );

drop policy if exists own_theme_targets on public.theme_targets;
create policy own_theme_targets
  on public.theme_targets
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_assets on public.assets;
create policy own_assets
  on public.assets
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_stock_subtypes_via_asset on public.stock_subtypes;
create policy own_stock_subtypes_via_asset
  on public.stock_subtypes
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.assets a
      where a.id = asset_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assets a
      where a.id = asset_id and a.user_id = auth.uid()
    )
  );

drop policy if exists own_transactions_via_subtype on public.transactions;
create policy own_transactions_via_subtype
  on public.transactions
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

drop policy if exists own_rsu_grants_via_subtype on public.rsu_grants;
create policy own_rsu_grants_via_subtype
  on public.rsu_grants
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

drop policy if exists own_option_contracts_via_asset on public.option_contracts;
create policy own_option_contracts_via_asset
  on public.option_contracts
  for all
  to authenticated
  using (exists (select 1 from public.assets a where a.id = asset_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.assets a where a.id = asset_id and a.user_id = auth.uid()));

drop policy if exists own_fixed_income_lots_via_asset on public.fixed_income_lots;
create policy own_fixed_income_lots_via_asset
  on public.fixed_income_lots
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.assets a
      where a.id = asset_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assets a
      where a.id = asset_id and a.user_id = auth.uid()
    )
  );

drop policy if exists own_user_settings on public.user_settings;
create policy own_user_settings
  on public.user_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_push_subscriptions on public.push_subscriptions;
create policy own_push_subscriptions
  on public.push_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_net_worth_snapshots on public.net_worth_snapshots;
create policy own_net_worth_snapshots
  on public.net_worth_snapshots
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_ticker_price_history on public.ticker_price_history;
create policy own_ticker_price_history
  on public.ticker_price_history
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_command_feedback on public.command_feedback;
create policy own_command_feedback
  on public.command_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_command_conversations on public.command_conversations;
create policy own_command_conversations
  on public.command_conversations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_portfolio_explanations on public.portfolio_explanations;
create policy own_portfolio_explanations
  on public.portfolio_explanations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_plaid_credentials on public.plaid_credentials;
create policy own_plaid_credentials
  on public.plaid_credentials
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Write-only from the client's perspective: no select policy, so the
-- secret can never be read back by the authenticated/anon roles.
drop policy if exists own_plaid_credential_secrets_insert on public.plaid_credential_secrets;
create policy own_plaid_credential_secrets_insert
  on public.plaid_credential_secrets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists own_plaid_credential_secrets_update on public.plaid_credential_secrets;
create policy own_plaid_credential_secrets_update
  on public.plaid_credential_secrets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Readable by its owner; only ever inserted/updated/deleted by edge
-- functions via the service-role client.
drop policy if exists own_plaid_items_select on public.plaid_items;
create policy own_plaid_items_select
  on public.plaid_items
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No policies at all on plaid_item_secrets: an access_token is never
-- reachable by the authenticated/anon roles, only by a service-role
-- edge function.

drop policy if exists own_plaid_pending_positions_select on public.plaid_pending_positions;
create policy own_plaid_pending_positions_select
  on public.plaid_pending_positions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists own_plaid_pending_positions_update on public.plaid_pending_positions;
create policy own_plaid_pending_positions_update
  on public.plaid_pending_positions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_plaid_pending_positions_delete on public.plaid_pending_positions;
create policy own_plaid_pending_positions_delete
  on public.plaid_pending_positions
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists own_plaid_synced_positions on public.plaid_synced_positions;
create policy own_plaid_synced_positions
  on public.plaid_synced_positions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

-- Confirm in PlaidReviewModal runs as the signed-in user (not an edge
-- function) and must be able to record the sync link itself after writing
-- the asset/transaction/lot -- a plain INSERT, never upserted.
drop policy if exists insert_own_plaid_synced_positions on public.plaid_synced_positions;
create policy insert_own_plaid_synced_positions
  on public.plaid_synced_positions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

drop policy if exists own_plaid_synced_transactions on public.plaid_synced_transactions;
create policy own_plaid_synced_transactions
  on public.plaid_synced_transactions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

drop policy if exists update_own_plaid_synced_transactions on public.plaid_synced_transactions;
create policy update_own_plaid_synced_transactions
  on public.plaid_synced_transactions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

drop policy if exists own_plaid_lot_links on public.plaid_lot_links;
create policy own_plaid_lot_links
  on public.plaid_lot_links
  for all
  to authenticated
  using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

-- Lets the client clear a position's drift flag after the user resolves it.
drop policy if exists update_own_plaid_synced_positions on public.plaid_synced_positions;
create policy update_own_plaid_synced_positions
  on public.plaid_synced_positions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );

drop policy if exists own_llm_usage_log on public.llm_usage_log;
create policy own_llm_usage_log
  on public.llm_usage_log
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Server-side Claude key (see migration 20261016000000)
create table if not exists public.llm_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- llm_credential_secrets has no select policy, so this flag is the only way
  -- the client can know the key actually made it to the database.
  secret_set boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.llm_credentials enable row level security;

drop policy if exists own_llm_credentials on public.llm_credentials;
create policy own_llm_credentials
  on public.llm_credentials
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Write-only from the client's perspective: insert/update only, no select
-- policy, so the key can never be read back by authenticated/anon roles.
create table if not exists public.llm_credential_secrets (
  user_id uuid primary key references public.llm_credentials(user_id) on delete cascade,
  api_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.llm_credential_secrets enable row level security;

drop policy if exists own_llm_credential_secrets_insert on public.llm_credential_secrets;
create policy own_llm_credential_secrets_insert
  on public.llm_credential_secrets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists own_llm_credential_secrets_update on public.llm_credential_secrets;
create policy own_llm_credential_secrets_update
  on public.llm_credential_secrets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-user request log for the proxies' rate limits (kind: 'llm' | 'market').
-- RLS on with no policies: only the service-role edge functions touch it.
create table if not exists public.api_proxy_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  called_at timestamptz not null default now()
);
create index if not exists api_proxy_calls_user_kind_called_idx
  on public.api_proxy_calls (user_id, kind, called_at desc);
alter table public.api_proxy_calls enable row level security;

-- Server-side Finnhub and CoinGecko keys (see migration 20261016000001)
create table if not exists public.market_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- market_credential_secrets has no select policy, so these flags are the
  -- only way the client can know a key actually made it to the database.
  finnhub_set boolean not null default false,
  coingecko_set boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.market_credentials enable row level security;

drop policy if exists own_market_credentials on public.market_credentials;
create policy own_market_credentials
  on public.market_credentials
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.market_credential_secrets (
  user_id uuid primary key references public.market_credentials(user_id) on delete cascade,
  finnhub_api_key text,
  coingecko_api_key text,
  updated_at timestamptz not null default now()
);

alter table public.market_credential_secrets enable row level security;

drop policy if exists own_market_credential_secrets_insert on public.market_credential_secrets;
create policy own_market_credential_secrets_insert
  on public.market_credential_secrets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists own_market_credential_secrets_update on public.market_credential_secrets;
create policy own_market_credential_secrets_update
  on public.market_credential_secrets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Save/replace functions for write-only API keys (see migration 20261016000002)
create or replace function public.save_llm_key(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_key is null or btrim(p_key) = '' then raise exception 'Enter a Claude API key.'; end if;
  insert into public.llm_credentials (user_id, secret_set, updated_at) values (uid, false, now())
    on conflict (user_id) do update set updated_at = now();
  insert into public.llm_credential_secrets (user_id, api_key, updated_at) values (uid, btrim(p_key), now())
    on conflict (user_id) do update set api_key = excluded.api_key, updated_at = now();
  update public.llm_credentials set secret_set = true where user_id = uid;
end $$;

revoke all on function public.save_llm_key(text) from public, anon;
grant execute on function public.save_llm_key(text) to authenticated;

create or replace function public.save_market_keys(p_finnhub text default null, p_coingecko text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
declare fh text := nullif(btrim(coalesce(p_finnhub, '')), '');
declare cg text := nullif(btrim(coalesce(p_coingecko, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if fh is null and cg is null then return; end if;
  insert into public.market_credentials (user_id, updated_at) values (uid, now())
    on conflict (user_id) do update set updated_at = now();
  insert into public.market_credential_secrets (user_id, finnhub_api_key, coingecko_api_key, updated_at) values (uid, fh, cg, now())
    on conflict (user_id) do update set
      finnhub_api_key = coalesce(excluded.finnhub_api_key, public.market_credential_secrets.finnhub_api_key),
      coingecko_api_key = coalesce(excluded.coingecko_api_key, public.market_credential_secrets.coingecko_api_key),
      updated_at = now();
  update public.market_credentials set
    finnhub_set = finnhub_set or fh is not null,
    coingecko_set = coingecko_set or cg is not null
  where user_id = uid;
end $$;

revoke all on function public.save_market_keys(text, text) from public, anon;
grant execute on function public.save_market_keys(text, text) to authenticated;

-- Save function for Plaid credentials (see migration 20261016000003)
create or replace function public.save_plaid_credentials(p_client_id text, p_env text, p_secret text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
declare sec text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  insert into public.plaid_credentials (user_id, client_id, plaid_env, updated_at) values (uid, p_client_id, coalesce(nullif(p_env, ''), 'production'), now())
    on conflict (user_id) do update set client_id = excluded.client_id, plaid_env = excluded.plaid_env, updated_at = now();
  if sec is not null then
    insert into public.plaid_credential_secrets (user_id, secret, updated_at) values (uid, sec, now())
      on conflict (user_id) do update set secret = excluded.secret, updated_at = now();
    update public.plaid_credentials set secret_set = true where user_id = uid;
  end if;
end $$;

revoke all on function public.save_plaid_credentials(text, text, text) from public, anon;
grant execute on function public.save_plaid_credentials(text, text, text) to authenticated;

-- Error tracking: the browser reports uncaught errors here so bugs are found
-- before a user reports them. Insert-only for signed-in users (no select
-- policy: nobody reads these from the browser; query them with the service
-- role / SQL editor / Supabase MCP). Messages and stacks only, never data.
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null,
  message text not null,
  stack text,
  url text,
  app_version text,
  user_agent text
);
create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert to authenticated
  with check (auth.uid() = user_id);

-- ─── Server-side daily net worth snapshots (migration 20261018000000) ───────
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

-- "Delete data" in Settings: wipes the signed-in user's portfolio, history and connections, but keeps the
-- account itself, its settings and its saved API keys. Child rows go via the existing on delete cascade FKs.
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from public.plaid_items where user_id = uid;
  delete from public.assets where user_id = uid;
  delete from public.locations where user_id = uid;
  delete from public.themes where user_id = uid;
  delete from public.tickers where user_id = uid;
  delete from public.net_worth_snapshots where user_id = uid;
  delete from public.ticker_price_history where user_id = uid;
  delete from public.portfolio_explanations where user_id = uid;
  delete from public.command_conversations where user_id = uid;
  delete from public.command_feedback where user_id = uid;
  delete from public.llm_usage_log where user_id = uid;
end $$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
