-- Plaid lot matching.
--
-- Plaid's investment transactions never say which lot a sell came out of, so the
-- ledger sync no longer guesses oldest-first: a sell is applied only when the lot
-- is provable (it empties the position, there's one lot, or Plaid's own remaining
-- lots account for it exactly). Anything else is stored here as `needs_lots`, with
-- enough detail for the user to pick the lots by hand, then marked `resolved`.
--
-- plaid_lot_links remembers which tracked lot a user paired with which Plaid lot
-- when their date or cost basis differ slightly, so later syncs recognise it.

alter table public.plaid_synced_transactions add column if not exists txn_date date;
alter table public.plaid_synced_transactions add column if not exists quantity numeric;
alter table public.plaid_synced_transactions add column if not exists price numeric;
alter table public.plaid_synced_transactions add column if not exists txn_type text;

alter table public.plaid_synced_transactions drop constraint if exists plaid_synced_transactions_status_check;
alter table public.plaid_synced_transactions
  add constraint plaid_synced_transactions_status_check
  check (status in ('applied', 'skipped', 'needs_lots', 'resolved'));

-- The client resolves a held sell (applies the user's lot choice, then flips the status).
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

alter table public.plaid_lot_links enable row level security;

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
