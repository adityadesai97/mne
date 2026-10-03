-- Plaid ledger sync: once a position is confirmed and linked, later buys,
-- sells, transfers and splits reported by Plaid's investment transactions are
-- applied to its lots automatically (see plaid-sync / plaid-sync-me).
-- plaid_synced_transactions is the idempotency ledger for that, and
-- plaid_synced_positions gains the drift-check columns used to flag a position
-- whose tracked shares differ from what Plaid reports.

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
  status text not null default 'applied' check (status in ('applied', 'skipped')),
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists plaid_synced_transactions_unique
  on public.plaid_synced_transactions (plaid_item_id, investment_transaction_id);

alter table public.plaid_synced_transactions enable row level security;

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
