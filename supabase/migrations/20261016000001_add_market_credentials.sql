-- Server-side Finnhub and CoinGecko keys. Like the Claude key, they are saved
-- write-only: the browser sends quote/news/profile requests through the
-- market-proxy edge function (which reads the key with the service role), and
-- check-prices reads them here too. user_settings.finnhub_api_key and
-- coingecko_api_key stay for now so the app can move each existing key over on
-- first load; a later migration drops them once every key has been moved.

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
