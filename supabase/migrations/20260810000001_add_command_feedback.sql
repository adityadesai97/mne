-- Stores user feedback on individual command bar agent responses: the
-- response being rated, the free-text feedback, and an optional attachment
-- (stored inline as base64 — feedback attachments are small, user-supplied
-- files like a screenshot, and this avoids requiring Supabase Storage setup
-- for self-hosters).
create table if not exists public.command_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_query text,
  agent_response text not null,
  feedback_text text,
  attachment_filename text,
  attachment_mime_type text,
  attachment_content text,
  created_at timestamptz not null default now()
);

alter table public.command_feedback enable row level security;

drop policy if exists own_command_feedback on public.command_feedback;
create policy own_command_feedback
  on public.command_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
