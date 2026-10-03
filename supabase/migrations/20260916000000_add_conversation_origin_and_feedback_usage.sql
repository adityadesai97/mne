-- Tracks which surface a command bar conversation started from (typed
-- directly, or seeded from the Portfolio Performance Explanation card), and
-- extends command_feedback with this turn's token usage + that origin —
-- so it's evident, on review, when feedback came from an
-- explanation-triggered session. See CLAUDE.md.

alter table public.command_conversations add column if not exists origin text not null default 'command_bar';

alter table public.command_feedback add column if not exists input_tokens int;
alter table public.command_feedback add column if not exists output_tokens int;
alter table public.command_feedback add column if not exists conversation_origin text not null default 'command_bar';
