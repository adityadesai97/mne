-- plaid_synced_positions previously had only a select policy. Nothing could
-- ever write to it from the client, so PlaidReviewModal's Confirm action
-- (which must run as the signed-in user, not an edge function) had no way
-- to record the sync link after writing the asset/transaction/lot -- the
-- table stayed permanently empty. That broke two things: the "synced via
-- Plaid" badge (nothing to key off), and plaid-sync's own idempotency check
-- (it could never find an existing link, so a confirmed position could be
-- re-detected and re-confirmed, creating a duplicate asset).
--
-- This is a plain INSERT (never upserted, so ON CONFLICT DO UPDATE's SELECT
-- requirement doesn't apply here the way it does for the secret tables).
drop policy if exists insert_own_plaid_synced_positions on public.plaid_synced_positions;
create policy insert_own_plaid_synced_positions
  on public.plaid_synced_positions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.plaid_items pi
      where pi.id = plaid_item_id and pi.user_id = auth.uid()
    )
  );
