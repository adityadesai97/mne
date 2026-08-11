-- Adds a "Fixed Income" super type covering CD, Deposit, and Bond accounts,
-- with interest rate and maturity date fields. Existing CD/Deposit assets
-- are migrated in place: asset_type becomes 'Fixed Income' and the specific
-- kind moves into the new fixed_income_subtype column.
alter table public.assets add column if not exists fixed_income_subtype text;
alter table public.assets add column if not exists interest_rate numeric(6,3);
alter table public.assets add column if not exists maturity_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_fixed_income_subtype_check'
      and conrelid = 'public.assets'::regclass
  ) then
    alter table public.assets
      add constraint assets_fixed_income_subtype_check
      check (fixed_income_subtype is null or fixed_income_subtype in ('CD', 'Deposit', 'Bond'));
  end if;
end $$;

-- The hosted project carries an asset_type allowlist (assets_asset_type_check)
-- that predates migration history / isn't in baseline.sql. Drop and recreate
-- it here so 'Fixed Income' is allowed and this guardrail is finally tracked;
-- a no-op on a DB that never had it (the drop is a no-op, the add is safe to
-- rerun since it always ends up in the same state).
alter table public.assets drop constraint if exists assets_asset_type_check;

update public.assets set fixed_income_subtype = 'CD', asset_type = 'Fixed Income' where asset_type = 'CD';
update public.assets set fixed_income_subtype = 'Deposit', asset_type = 'Fixed Income' where asset_type = 'Deposit';

alter table public.assets
  add constraint assets_asset_type_check
  check (asset_type in ('Stock', '401k', 'Fixed Income', 'Cash', 'HSA'));
