-- Plaid integration: each user brings their own free Plaid developer
-- credentials (client_id/secret) -- not one credential set shared across
-- the deployment -- so the 10-Item Trial cap belongs to each user alone.
-- Secrets (the Plaid app secret, and each connected Item's access_token)
-- are never readable by the authenticated/anon roles at all -- only a
-- service-role edge function can read or write them. Detected positions
-- land in plaid_pending_positions for the user to review and confirm
-- before anything is written to assets/transactions/fixed_income_lots.

-- Per-user Plaid developer credentials. client_id is fine to be
-- owner-readable (it's closer to a publishable identifier); the secret
-- lives in a separate table below with no select policy at all.
create table if not exists public.plaid_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text,
  plaid_env text not null default 'production',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plaid_credentials enable row level security;

drop policy if exists own_plaid_credentials on public.plaid_credentials;
create policy own_plaid_credentials
  on public.plaid_credentials
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Write-only from the client's perspective (like a password-change field):
-- insert/update are allowed so the user can set or rotate their own secret
-- from Settings, but there is deliberately no select policy, so it can
-- never be read back by the authenticated/anon roles -- only a
-- service-role edge function reads it.
create table if not exists public.plaid_credential_secrets (
  user_id uuid primary key references public.plaid_credentials(user_id) on delete cascade,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table public.plaid_credential_secrets enable row level security;

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

-- One row per connected institution login ("Item" in Plaid's terms).
-- Readable by its owner (institution name/status/last sync, so the UI can
-- show connection state and count toward the 10-Item cap), but only ever
-- inserted/updated/deleted by edge functions via the service-role client --
-- a client can never insert a fake row to sneak past the cap.
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

alter table public.plaid_items enable row level security;

drop policy if exists own_plaid_items_select on public.plaid_items;
create policy own_plaid_items_select
  on public.plaid_items
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Same zero-select-policy pattern as plaid_credential_secrets: a Plaid
-- access_token is never reachable by the authenticated/anon roles, only by
-- a service-role edge function.
create table if not exists public.plaid_item_secrets (
  item_id uuid primary key references public.plaid_items(id) on delete cascade,
  access_token text not null
);

alter table public.plaid_item_secrets enable row level security;

-- Staging area for positions a sync detected but the user hasn't confirmed
-- yet -- nothing here has been written to assets/transactions/
-- fixed_income_lots. matched_asset_id is set when the position's natural
-- key (asset type + name + location + ownership + ticker + subtype, same
-- as the import/export dedup logic) matches an existing manually-entered
-- asset, so the review screen can label the row "will update" vs "new".
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

alter table public.plaid_pending_positions enable row level security;

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

-- Idempotency map: once a pending position is confirmed, later syncs update
-- the linked asset/transaction/lot in place instead of re-flagging it for
-- review. Uses a real DB-level cascade from assets/transactions/
-- fixed_income_lots (unlike the manual JS cascade in deleteAsset) since
-- this table is new and entirely under our control.
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

alter table public.plaid_synced_positions enable row level security;

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

create unique index if not exists plaid_synced_positions_unique
  on public.plaid_synced_positions (plaid_item_id, external_account_id, coalesce(external_security_id, ''));
