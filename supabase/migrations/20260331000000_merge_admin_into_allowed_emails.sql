-- Merge admin_users into allowed_emails
-- Adds is_admin column, migrates admin data, drops admin_users table.

-- 1. Add is_admin column
alter table public.allowed_emails
  add column if not exists is_admin boolean not null default false;

-- 2. Helper function (security definer bypasses RLS, avoiding self-referential recursion)
create or replace function public.is_allowed_email_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and is_admin = true
  )
$$;

-- 3. Replace the policy that references admin_users BEFORE dropping that table
drop policy if exists allowlist_admin_manage on public.allowed_emails;
create policy allowlist_admin_manage
  on public.allowed_emails
  for all
  to authenticated
  using (public.is_allowed_email_admin())
  with check (public.is_allowed_email_admin());

-- 4. Promote existing admin_users rows into allowed_emails
insert into public.allowed_emails (email, is_admin)
select lower(email), true
from public.admin_users
on conflict (email) do update set is_admin = true;

-- 5. Drop old table (policy no longer depends on it)
drop table if exists public.admin_users;
