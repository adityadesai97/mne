-- Crypto holdings live in locations (exchanges/wallets) of their own account
-- type, 'Crypto', rather than 'Investment'.
--
-- Some hosted projects carry an account_type allowlist on locations
-- (locations_account_type_check) that predates migration history and isn't
-- in baseline.sql / self_host_bootstrap.sql. Where it exists, recreate it with
-- 'Crypto' included (only ever widens, so existing rows still satisfy it).
-- Where it doesn't (self-hosted projects), do nothing — don't start
-- constraining a column that was never constrained there.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.locations'::regclass and conname = 'locations_account_type_check'
  ) then
    alter table public.locations drop constraint locations_account_type_check;
    alter table public.locations
      add constraint locations_account_type_check
      check (account_type in ('Investment', 'Checking', 'Savings', 'Misc', 'Crypto'));
  end if;
end $$;
