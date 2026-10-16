-- Saving or replacing a write-only API key must go through a function.
--
-- llm_credential_secrets and market_credential_secrets have RLS on and no
-- select policy by design. That makes a client-side "UPDATE ... WHERE user_id =
-- ...; if nothing updated then INSERT" fail on the second save: Postgres needs
-- select access to see the row the UPDATE targets, so the UPDATE silently
-- matches nothing, the INSERT runs, and it collides with the existing primary
-- key ("duplicate key value violates unique constraint ..._pkey"). These
-- security definer functions upsert server-side for the calling user only.

create or replace function public.save_llm_key(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_key is null or btrim(p_key) = '' then raise exception 'Enter a Claude API key.'; end if;
  insert into public.llm_credentials (user_id, secret_set, updated_at) values (uid, false, now())
    on conflict (user_id) do update set updated_at = now();
  insert into public.llm_credential_secrets (user_id, api_key, updated_at) values (uid, btrim(p_key), now())
    on conflict (user_id) do update set api_key = excluded.api_key, updated_at = now();
  update public.llm_credentials set secret_set = true where user_id = uid;
end $$;

revoke all on function public.save_llm_key(text) from public, anon;
grant execute on function public.save_llm_key(text) to authenticated;

create or replace function public.save_market_keys(p_finnhub text default null, p_coingecko text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
declare fh text := nullif(btrim(coalesce(p_finnhub, '')), '');
declare cg text := nullif(btrim(coalesce(p_coingecko, '')), '');
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if fh is null and cg is null then return; end if;
  insert into public.market_credentials (user_id, updated_at) values (uid, now())
    on conflict (user_id) do update set updated_at = now();
  insert into public.market_credential_secrets (user_id, finnhub_api_key, coingecko_api_key, updated_at) values (uid, fh, cg, now())
    on conflict (user_id) do update set
      finnhub_api_key = coalesce(excluded.finnhub_api_key, public.market_credential_secrets.finnhub_api_key),
      coingecko_api_key = coalesce(excluded.coingecko_api_key, public.market_credential_secrets.coingecko_api_key),
      updated_at = now();
  update public.market_credentials set
    finnhub_set = finnhub_set or fh is not null,
    coingecko_set = coingecko_set or cg is not null
  where user_id = uid;
end $$;

revoke all on function public.save_market_keys(text, text) from public, anon;
grant execute on function public.save_market_keys(text, text) to authenticated;
