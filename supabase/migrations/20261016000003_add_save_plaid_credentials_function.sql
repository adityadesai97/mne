-- Same fix as 20261016000002 for the Plaid credentials: plaid_credential_secrets
-- has no select policy, so a client-side UPDATE-then-INSERT fails on every
-- save after the first (duplicate primary key). Save through a security definer
-- function that upserts for the calling user only.

create or replace function public.save_plaid_credentials(p_client_id text, p_env text, p_secret text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
declare sec text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  insert into public.plaid_credentials (user_id, client_id, plaid_env, updated_at) values (uid, p_client_id, coalesce(nullif(p_env, ''), 'production'), now())
    on conflict (user_id) do update set client_id = excluded.client_id, plaid_env = excluded.plaid_env, updated_at = now();
  if sec is not null then
    insert into public.plaid_credential_secrets (user_id, secret, updated_at) values (uid, sec, now())
      on conflict (user_id) do update set secret = excluded.secret, updated_at = now();
    update public.plaid_credentials set secret_set = true where user_id = uid;
  end if;
end $$;

revoke all on function public.save_plaid_credentials(text, text, text) from public, anon;
grant execute on function public.save_plaid_credentials(text, text, text) to authenticated;
