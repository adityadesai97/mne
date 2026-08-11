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

alter table public.fixed_income_lots enable row level security;

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
