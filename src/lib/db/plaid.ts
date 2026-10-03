import { getSupabaseClient } from '../supabase'
import { planLedger, type LedgerLot } from '../plaidLedger'
import { localDateKey } from '../portfolio'
import { deleteAsset } from './assets'

// Client-side helpers for the Plaid integration. Each user configures their
// own Plaid developer credentials (client_id/secret) here, the same way they
// configure their own Claude/Groq/Finnhub key — see CLAUDE.md's Plaid
// Integration section. The secret itself is write-only from this client:
// plaid_credential_secrets has no select policy, so it is never read back
// here, only ever written.

export interface PlaidCredentialsStatus {
  configured: boolean
  clientId: string | null
  plaidEnv: string
}

export async function getPlaidCredentialsStatus(): Promise<PlaidCredentialsStatus> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return { configured: false, clientId: null, plaidEnv: 'production' }
  const { data, error } = await getSupabaseClient()
    .from('plaid_credentials')
    .select('client_id, plaid_env, secret_set')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  // "Configured" requires both — client_id alone isn't enough. The secret
  // table has no select policy at all (see savePlaidCredentials), so
  // secret_set is the only way the client can know whether a secret
  // actually made it to the database; a client_id can save successfully
  // while the secret write fails, and if "configured" only checked
  // client_id, that half-saved state would look fully configured.
  return {
    configured: !!data?.client_id && !!data?.secret_set,
    clientId: data?.client_id ?? null,
    plaidEnv: data?.plaid_env ?? 'production',
  }
}

export async function savePlaidCredentials(clientId: string, plaidEnv: string, secret: string): Promise<void> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error: credError } = await getSupabaseClient()
    .from('plaid_credentials')
    .upsert(
      { user_id: user.id, client_id: clientId, plaid_env: plaidEnv, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (credError) throw credError

  // Only sent when the user actually typed a new secret — "rotate" leaves
  // an existing one in place if the field was left blank.
  //
  // Deliberately not .upsert(): Postgres requires SELECT privilege on a
  // table to use INSERT ... ON CONFLICT DO UPDATE (to detect the conflict),
  // and plaid_credential_secrets has no select policy at all by design —
  // so an upsert here gets a real 403 insufficient_privilege, which the
  // app's global 403-on-/rest/v1/ handler (src/lib/supabase.ts) treats as a
  // dead session and force-signs the user out. A plain UPDATE (filtered by
  // its own USING policy, no SELECT needed) falling back to a plain INSERT
  // avoids the conflict-detection path entirely.
  if (secret) {
    const { error: updateError, count } = await getSupabaseClient()
      .from('plaid_credential_secrets')
      .update({ secret, updated_at: new Date().toISOString() }, { count: 'exact' })
      .eq('user_id', user.id)
    if (updateError) throw updateError
    if (!count) {
      const { error: insertError } = await getSupabaseClient()
        .from('plaid_credential_secrets')
        .insert({ user_id: user.id, secret, updated_at: new Date().toISOString() })
      if (insertError) throw insertError
    }

    // plaid_credential_secrets has no select policy, so this flag on the
    // (readable) plaid_credentials row is the only way getPlaidCredentialsStatus
    // can tell the secret actually made it into the database.
    const { error: flagError } = await getSupabaseClient()
      .from('plaid_credentials')
      .update({ secret_set: true })
      .eq('user_id', user.id)
    if (flagError) throw flagError
  }
}

export interface PlaidItem {
  id: string
  institution_id: string | null
  institution_name: string | null
  status: 'active' | 'error' | 'disconnected'
  created_at: string
  last_synced_at: string | null
  // Plaid's own error code/message from the last failed sync (null when healthy).
  last_error: string | null
}

export const PLAID_ITEM_LIMIT = 10

export async function listPlaidItems(): Promise<PlaidItem[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_items')
    .select('id, institution_id, institution_name, status, created_at, last_synced_at, last_error')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface PendingPlaidPosition {
  id: string
  plaid_item_id: string
  external_account_id: string
  external_security_id: string | null
  detected_type: 'stock' | 'cash' | 'fixed_income' | 'stock_plan'
  payload: Record<string, unknown>
  matched_asset_id: string | null
  created_at: string
}

export async function getPendingPlaidPositionsCount(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

export async function listPendingPositions(): Promise<PendingPlaidPosition[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .select('id, plaid_item_id, external_account_id, external_security_id, detected_type, payload, matched_asset_id, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface ConfirmedPlaidLink {
  assetId?: string
  transactionId?: string
  fixedIncomeLotId?: string
}

// Records the link a just-confirmed position's write created, so a later
// plaid-sync run can find it (update in place) instead of re-detecting the
// same account/security as new. Nothing enforces this is called exactly
// once per row, but the DB's own unique index on
// (plaid_item_id, external_account_id, external_security_id) throws a plain
// 23505 on a second attempt rather than a 403, so it fails safely.
export async function recordPlaidSyncLink(row: PendingPlaidPosition, link: ConfirmedPlaidLink): Promise<void> {
  const { error } = await getSupabaseClient().from('plaid_synced_positions').insert({
    plaid_item_id: row.plaid_item_id,
    external_account_id: row.external_account_id,
    external_security_id: row.external_security_id,
    asset_id: link.assetId ?? null,
    transaction_id: link.transactionId ?? null,
    fixed_income_lot_id: link.fixedIncomeLotId ?? null,
  })
  if (error) throw error
}

export async function markPendingPositionConfirmed(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .update({ status: 'confirmed' })
    .eq('id', id)
  if (error) throw error
}

export async function dismissPendingPosition(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('plaid_pending_positions')
    .update({ status: 'dismissed' })
    .eq('id', id)
  if (error) throw error
}

export async function createPlaidLinkToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-create-link-token')
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data.link_token
}

export async function exchangePlaidPublicToken(
  publicToken: string,
  institutionId: string | null,
  institutionName: string | null,
): Promise<{ pendingCount: number }> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-exchange-token', {
    body: { public_token: publicToken, institution_id: institutionId, institution_name: institutionName },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { pendingCount: data.pendingCount ?? 0 }
}

export async function syncPlaidNow(): Promise<{ pendingCount: number }> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-sync-me')
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { pendingCount: data.pendingCount ?? 0 }
}

export async function removePlaidItem(plaidItemId: string): Promise<void> {
  const { data, error } = await getSupabaseClient().functions.invoke('plaid-remove-item', {
    body: { plaid_item_id: plaidItemId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
}

// A linked position whose tracked shares differ from what Plaid reports — the
// sync's safety net for anything the transaction ledger couldn't explain (a
// same-day trade, a transfer without a price, an institution with no
// transaction feed). Never auto-corrected; the user resolves it explicitly.
export interface PlaidDriftPosition {
  id: string
  assetId: string
  assetName: string
  symbol: string | null
  plaidQuantity: number
  driftShares: number
  plaidCostPrice: number | null
  tickerPrice: number | null
}

export async function listPlaidDriftPositions(): Promise<PlaidDriftPosition[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_synced_positions')
    .select('id, asset_id, plaid_quantity, plaid_cost_price, drift_shares, asset:assets(name, ticker:tickers(symbol, current_price))')
    .not('drift_shares', 'is', null)
    .neq('drift_shares', 0)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    assetId: r.asset_id,
    assetName: r.asset?.name ?? 'Position',
    symbol: r.asset?.ticker?.symbol ?? null,
    plaidQuantity: Number(r.plaid_quantity ?? 0),
    driftShares: Number(r.drift_shares),
    plaidCostPrice: r.plaid_cost_price != null ? Number(r.plaid_cost_price) : null,
    tickerPrice: r.asset?.ticker?.current_price != null ? Number(r.asset.ticker.current_price) : null,
  }))
}

// Brings a drifted position's tracked shares in line with Plaid: extra shares
// become a new lot dated today (costed at Plaid's average cost, else the
// current price), missing shares are taken oldest-lot-first. Only Market lots
// are ever touched — a gap that lives in RSU/ESPP lots is left for the user.
export async function resolvePlaidDrift(pos: PlaidDriftPosition): Promise<void> {
  const supabase = getSupabaseClient()
  const today = localDateKey()

  const { data: marketSubtype, error: subtypeError } = await supabase
    .from('stock_subtypes')
    .select('id')
    .eq('asset_id', pos.assetId)
    .eq('subtype', 'Market')
    .maybeSingle()
  if (subtypeError) throw subtypeError

  if (pos.driftShares > 0) {
    const cost = pos.plaidCostPrice ?? pos.tickerPrice
    if (cost == null) throw new Error('No cost basis from Plaid and no current price — add the shares manually.')
    let subtypeId = marketSubtype?.id as string | undefined
    if (!subtypeId) {
      const { data, error } = await supabase
        .from('stock_subtypes')
        .insert({ asset_id: pos.assetId, subtype: 'Market' })
        .select('id')
        .single()
      if (error) throw error
      subtypeId = data.id as string
    }
    const { error } = await supabase.from('transactions').insert({
      subtype_id: subtypeId,
      count: Math.round(pos.driftShares * 1e6) / 1e6,
      cost_price: Math.round(cost * 1e4) / 1e4,
      purchase_date: today,
      capital_gains_status: 'Short Term',
    })
    if (error) throw error
  } else {
    if (!marketSubtype) throw new Error('No regular lots to reduce — this difference is in RSU/ESPP shares; adjust it manually.')
    const { data: lots, error: lotsError } = await supabase
      .from('transactions')
      .select('id, count, cost_price, purchase_date')
      .eq('subtype_id', marketSubtype.id)
    if (lotsError) throw lotsError
    const plan = planLedger((lots ?? []) as LedgerLot[], [
      { investment_transaction_id: 'drift', date: today, type: 'sell', subtype: 'sell', quantity: pos.driftShares, price: null },
    ])
    if (plan.skipped.length > 0) {
      throw new Error('Plaid shows fewer shares than the regular lots hold — the rest is in RSU/ESPP lots; adjust it manually.')
    }
    for (const op of plan.ops) {
      if (op.kind === 'update_lot') {
        const { error } = await supabase.from('transactions').update({ count: op.count }).eq('id', op.lotId)
        if (error) throw error
      } else if (op.kind === 'delete_lot') {
        const { error } = await supabase.from('transactions').delete().eq('id', op.lotId)
        if (error) throw error
      }
    }
  }

  if (pos.plaidQuantity <= 0) {
    // Plaid no longer holds it at all: same cleanup a manual full sell does,
    // except an asset with a still-active RSU grant stays (its future vests
    // belong to it).
    const { data: grantRows, error: grantError } = await supabase
      .from('stock_subtypes')
      .select('rsu_grants(id, ended_at)')
      .eq('asset_id', pos.assetId)
    if (grantError) throw grantError
    const hasActiveGrant = (grantRows ?? []).some((r: any) => (r.rsu_grants ?? []).some((g: any) => !g.ended_at))
    if (!hasActiveGrant) {
      await deleteAsset(pos.assetId)
      return
    }
  }
  const { error } = await supabase.from('plaid_synced_positions').update({ drift_shares: 0 }).eq('id', pos.id)
  if (error) throw error
}
