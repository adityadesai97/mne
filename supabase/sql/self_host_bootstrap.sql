-- mne self-host bootstrap schema
-- Purpose: initialize (or upgrade) a Supabase project so the current app can run locally.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Optional allowlist table (used only when VITE_RESTRICT_SIGNUPS=true)
create table if not exists public.allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

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

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claude_api_key text,
  finnhub_api_key text,
  price_alert_threshold numeric(5,2) default 5.0,
  tax_harvest_threshold numeric(12,2) default 1000.0,
  rsu_alert_days_before int default 7,
  auto_theme_assignment_enabled boolean not null default true
);
create unique index if not exists user_settings_user_id_key
  on public.user_settings (user_id);
alter table public.user_settings add column if not exists tax_harvest_threshold numeric(12,2) default 1000.0;
alter table public.user_settings add column if not exists price_alert_threshold numeric(5,2) default 5.0;
alter table public.user_settings add column if not exists rsu_alert_days_before int default 7;
alter table public.user_settings add column if not exists claude_api_key text;
alter table public.user_settings add column if not exists finnhub_api_key text;
alter table public.user_settings add column if not exists auto_theme_assignment_enabled boolean not null default true;

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

-- RLS
alter table public.allowed_emails enable row level security;
alter table public.locations enable row level security;
alter table public.tickers enable row level security;
alter table public.themes enable row level security;
alter table public.ticker_themes enable row level security;
alter table public.theme_targets enable row level security;
alter table public.assets enable row level security;
alter table public.stock_subtypes enable row level security;
alter table public.transactions enable row level security;
alter table public.rsu_grants enable row level security;
alter table public.user_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.net_worth_snapshots enable row level security;

drop policy if exists allowlist_self_read on public.allowed_emails;
create policy allowlist_self_read
  on public.allowed_emails
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

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
