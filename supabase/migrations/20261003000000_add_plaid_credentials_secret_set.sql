-- plaid_credential_secrets has no select policy by design (the secret can
-- never be read back by a normal client), so the client has no way to know
-- whether a secret actually exists for a given user. Track that instead as
-- a plain boolean on the readable plaid_credentials row, set whenever
-- savePlaidCredentials successfully writes the secret -- this is what
-- "configured" should actually mean, not just "client_id is set".
alter table public.plaid_credentials add column if not exists secret_set boolean not null default false;

-- Backfill: anyone who genuinely has a secret on file today should be
-- marked configured.
update public.plaid_credentials
set secret_set = true
where user_id in (select user_id from public.plaid_credential_secrets);
