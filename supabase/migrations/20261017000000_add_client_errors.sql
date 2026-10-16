-- Error tracking: the browser reports uncaught errors here so bugs are found
-- before a user reports them. Insert-only for signed-in users (no select
-- policy: nobody reads these from the browser; query them with the service
-- role / SQL editor / Supabase MCP). Messages and stacks only, never data.
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  source text not null,
  message text not null,
  stack text,
  url text,
  app_version text,
  user_agent text
);
create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert to authenticated
  with check (auth.uid() = user_id);
