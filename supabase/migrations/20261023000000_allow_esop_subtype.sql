-- ESOP grants live under a stock_subtypes row with subtype 'ESOP', but some
-- hosted projects carry a subtype allowlist (stock_subtypes_subtype_check)
-- that predates migration history and isn't in baseline.sql /
-- self_host_bootstrap.sql, so creating an option grant failed with a check
-- violation. Where it exists, recreate it with 'ESOP' included (only widens).
-- Where it doesn't (self-hosted), do nothing.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.stock_subtypes'::regclass and conname = 'stock_subtypes_subtype_check'
  ) then
    alter table public.stock_subtypes drop constraint stock_subtypes_subtype_check;
    alter table public.stock_subtypes
      add constraint stock_subtypes_subtype_check
      check (subtype in ('Market', 'ESPP', 'RSU', 'ESOP'));
  end if;
end $$;
