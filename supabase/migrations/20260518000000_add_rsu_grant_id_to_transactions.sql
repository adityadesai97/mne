alter table public.transactions
  add column if not exists rsu_grant_id uuid references public.rsu_grants(id) on delete set null;
