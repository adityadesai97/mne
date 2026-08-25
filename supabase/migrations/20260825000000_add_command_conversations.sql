-- Persists every command bar conversation so it can be listed (with a short
-- title derived from the user's first prompt) and resumed later. Messages
-- are stored as a JSONB array of {role, content} — the same shape the
-- command bar already threads through runCommand's history — rather than a
-- child table, since a conversation's message list is always read/written
-- as a whole (no per-message queries needed).
create table if not exists public.command_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.command_conversations enable row level security;

drop policy if exists own_command_conversations on public.command_conversations;
create policy own_command_conversations
  on public.command_conversations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists command_conversations_user_updated_idx
  on public.command_conversations (user_id, updated_at desc);
