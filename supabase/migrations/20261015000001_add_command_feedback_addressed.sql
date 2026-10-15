-- Lets the feedback-synthesis skill track which feedback has been dealt with.
-- Set by the maintainer (via the Supabase MCP / SQL editor), never by the app.
alter table public.command_feedback add column if not exists addressed_at timestamptz;
alter table public.command_feedback add column if not exists fix_commit text;
