-- 20260921000000 added Crypto as an asset type in the app, but assets carries
-- an asset_type allowlist (assets_asset_type_check, see
-- 20260811000000_add_fixed_income_asset_type.sql) that rejected it. Recreate
-- it with 'Crypto' included. Only ever widens the allowlist, so every
-- existing row still satisfies it.
alter table public.assets drop constraint if exists assets_asset_type_check;
alter table public.assets
  add constraint assets_asset_type_check
  check (asset_type in ('Stock', 'Crypto', '401k', 'Fixed Income', 'Cash', 'HSA'));
