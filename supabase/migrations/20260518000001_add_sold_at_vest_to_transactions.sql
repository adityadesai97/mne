alter table public.transactions
  add column if not exists sold_at_vest numeric(12,6) not null default 0;
