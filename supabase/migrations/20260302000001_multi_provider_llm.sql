alter table public.user_settings
  add column if not exists llm_provider text not null default 'claude',
  add column if not exists groq_api_key text,
  add column if not exists gemini_api_key text;
