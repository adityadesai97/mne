-- "Delete data" in Settings: wipes the signed-in user's portfolio, history and connections, but keeps the
-- account itself, its settings and its saved API keys. Child rows go via the existing on delete cascade FKs.
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from public.plaid_items where user_id = uid;
  delete from public.assets where user_id = uid;
  delete from public.locations where user_id = uid;
  delete from public.themes where user_id = uid;
  delete from public.tickers where user_id = uid;
  delete from public.net_worth_snapshots where user_id = uid;
  delete from public.ticker_price_history where user_id = uid;
  delete from public.portfolio_explanations where user_id = uid;
  delete from public.command_conversations where user_id = uid;
  delete from public.command_feedback where user_id = uid;
  delete from public.llm_usage_log where user_id = uid;
end $$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
