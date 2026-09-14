-- Portfolio Performance Explanation: a toggleable, LLM-generated summary of
-- why the user's portfolio moved, regenerated on a major move, at market
-- close, or manually. See CLAUDE.md for the full design (token-efficiency
-- rules, mover/theme/market-move detection tiers).

alter table public.user_settings add column if not exists portfolio_explanation_enabled boolean not null default false;

create table if not exists public.portfolio_explanations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  has_major_moves boolean not null default false,
  day_change_dollars numeric(14,2),
  day_change_percent numeric(8,4),
  basis_net_worth numeric(14,2),
  movers jsonb not null default '[]'::jsonb,
  is_broad_market_move boolean not null default false,
  market_headlines jsonb not null default '[]'::jsonb,
  theme_moves jsonb not null default '[]'::jsonb,
  trigger text not null,
  input_tokens int,
  output_tokens int,
  generated_at timestamptz not null default now()
);
create unique index if not exists portfolio_explanations_user_id_key
  on public.portfolio_explanations (user_id);

-- Append-only usage ledger shared by both LLM-powered features (portfolio
-- explanations + the command bar) so cost/trend queries have one place to
-- look, regardless of which feature generated the call. Each feature also
-- denormalizes its own latest/running totals for cheap inline display —
-- see portfolio_explanations.input_tokens/output_tokens above and
-- command_conversations.total_input_tokens/total_output_tokens below.
create table if not exists public.llm_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  conversation_id uuid references public.command_conversations(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists llm_usage_log_user_feature_created_idx
  on public.llm_usage_log (user_id, feature, created_at desc);

alter table public.command_conversations add column if not exists total_input_tokens int not null default 0;
alter table public.command_conversations add column if not exists total_output_tokens int not null default 0;

-- RLS
alter table public.portfolio_explanations enable row level security;
alter table public.llm_usage_log enable row level security;

drop policy if exists own_portfolio_explanations on public.portfolio_explanations;
create policy own_portfolio_explanations
  on public.portfolio_explanations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists own_llm_usage_log on public.llm_usage_log;
create policy own_llm_usage_log
  on public.llm_usage_log
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
