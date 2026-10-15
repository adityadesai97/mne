-- Server-side Claude key. The browser no longer holds the Anthropic API key:
-- it is saved write-only here and only the llm-proxy edge function (service
-- role) ever reads it. Same pattern as plaid_credential_secrets.
--
-- Also removes Groq support (never used): the provider picker, its key and
-- the llm_provider column are gone. user_settings.claude_api_key stays for
-- now so the app can move each existing key into llm_credential_secrets on
-- first load; a later migration drops it once every key has been moved.

create table if not exists public.llm_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- llm_credential_secrets has no select policy, so this flag is the only way
  -- the client can know the key actually made it to the database.
  secret_set boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.llm_credentials enable row level security;

drop policy if exists own_llm_credentials on public.llm_credentials;
create policy own_llm_credentials
  on public.llm_credentials
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Write-only from the client's perspective: insert/update only, no select
-- policy, so the key can never be read back by authenticated/anon roles.
create table if not exists public.llm_credential_secrets (
  user_id uuid primary key references public.llm_credentials(user_id) on delete cascade,
  api_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.llm_credential_secrets enable row level security;

drop policy if exists own_llm_credential_secrets_insert on public.llm_credential_secrets;
create policy own_llm_credential_secrets_insert
  on public.llm_credential_secrets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists own_llm_credential_secrets_update on public.llm_credential_secrets;
create policy own_llm_credential_secrets_update
  on public.llm_credential_secrets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-user request log for the proxy's rate limit. RLS on with no policies:
-- only the service-role edge function touches it.
create table if not exists public.llm_proxy_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  called_at timestamptz not null default now()
);
create index if not exists llm_proxy_calls_user_called_idx
  on public.llm_proxy_calls (user_id, called_at desc);
alter table public.llm_proxy_calls enable row level security;

alter table public.user_settings drop column if exists groq_api_key;
alter table public.user_settings drop column if exists llm_provider;
