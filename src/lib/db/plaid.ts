import { getSupabaseClient } from '../supabase'
import { planLedger, type LedgerLot } from '../plaidLedger'
import { allocationOps, validateAllocation } from '../plaidLotAllocation'
import { localDateKey } from '../portfolio'
import { deleteAsset } from './assets'

// Client-side helpers for the Plaid integration. Each user configures their
// own Plaid developer credentials (client_id/secret) here, the same way they
// configure their own Claude/Finnhub key — see CLAUDE.md's Plaid
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
  // One server-side function (save_plaid_credentials, security definer) writes
  // the credentials, the secret and the secret_set flag for the calling user.
  // The secret is only sent when the user actually typed one — "rotate" leaves
  // an existing secret in place if the field was left blank.
  //
  // Not table writes: plaid_credential_secrets has no select policy at all by
  // design, so an .upsert() gets a 403 insufficient_privilege (which the app's
  // global 403 handler in src/lib/supabase.ts reads as a dead session and
  // signs the user out), and an update-then-insert fails on every save after
  // the first (the UPDATE sees no rows without select access, so the INSERT
  // hits the primary key).
  const { error } = await getSupabaseClient().rpc('save_plaid_credentials', {
    p_client_id: clientId,
    p_env: plaidEnv,
    p_secret: secret || null,
  })
  if (error) throw error
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
  isCrypto: boolean
  symbol: string | null
  plaidQuantity: number
  driftShares: number
  plaidCostPrice: number | null
  tickerPrice: number | null
}

export async function listPlaidDriftPositions(): Promise<PlaidDriftPosition[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_synced_positions')
    .select('id, asset_id, plaid_quantity, plaid_cost_price, drift_shares, asset:assets(name, asset_type, ticker:tickers(symbol, current_price))')
    .not('drift_shares', 'is', null)
    .neq('drift_shares', 0)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    assetId: r.asset_id,
    assetName: r.asset?.name ?? 'Position',
    isCrypto: r.asset?.asset_type === 'Crypto',
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
      count: Math.round(pos.driftShares * 1e8) / 1e8,
      cost_price: Math.round(cost * 1e8) / 1e8,
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
    ], { sellMode: 'fifo' })
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

// ── Sells waiting for the user to pick lots ──────────────────────────────────
// Plaid's investment transactions don't say which lot a sell came out of, so the
// sync only applies one when the lot is provable; otherwise it parks it here
// (plaid_synced_transactions.status = 'needs_lots') and changes nothing.

export interface HeldSellLot {
  id: string
  count: number
  cost_price: number
  purchase_date: string
}

export interface HeldLotSell {
  id: string
  assetId: string
  assetName: string
  symbol: string | null
  isCrypto: boolean
  date: string
  quantity: number
  price: number | null
  /** The position's regular (Market) lots as they stand now; RSU/ESPP lots are never part of a sync. */
  lots: HeldSellLot[]
}

export async function listHeldLotSells(): Promise<HeldLotSell[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('plaid_synced_transactions')
    .select('id, asset_id, txn_date, quantity, price, asset:assets(name, asset_type, ticker:tickers(symbol))')
    .eq('status', 'needs_lots')
    .order('txn_date', { ascending: true })
  if (error) throw error
  const rows = (data ?? []).filter((r: any) => r.asset_id && r.asset)
  if (rows.length === 0) return []

  const assetIds = Array.from(new Set(rows.map((r: any) => r.asset_id as string)))
  const { data: subtypes, error: lotError } = await supabase
    .from('stock_subtypes')
    .select('asset_id, transactions(id, count, cost_price, purchase_date)')
    .in('asset_id', assetIds)
    .eq('subtype', 'Market')
  if (lotError) throw lotError
  const lotsByAsset = new Map<string, HeldSellLot[]>()
  for (const s of subtypes ?? []) {
    lotsByAsset.set(
      (s as any).asset_id,
      ((s as any).transactions ?? []).map((t: any) => ({
        id: t.id,
        count: Number(t.count),
        cost_price: Number(t.cost_price),
        purchase_date: String(t.purchase_date).slice(0, 10),
      })),
    )
  }
  return rows.map((r: any) => ({
    id: r.id,
    assetId: r.asset_id,
    assetName: r.asset.name,
    symbol: r.asset.ticker?.symbol ?? null,
    isCrypto: r.asset.asset_type === 'Crypto',
    date: String(r.txn_date ?? '').slice(0, 10),
    quantity: Number(r.quantity),
    price: r.price != null ? Number(r.price) : null,
    lots: (lotsByAsset.get(r.asset_id) ?? []).sort((a, b) => a.purchase_date.localeCompare(b.purchase_date)),
  }))
}

// Same cleanup a manual full sell does: a position with no shares left and no active
// RSU grant is removed (an active grant keeps it, its future vests belong to it).
async function removeAssetIfFullySold(assetId: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('stock_subtypes')
    .select('transactions(count, sold_at_vest), rsu_grants(id, ended_at)')
    .eq('asset_id', assetId)
  if (error) throw error
  let shares = 0
  let hasActiveGrant = false
  for (const s of data ?? []) {
    for (const t of (s as any).transactions ?? []) {
      shares += Math.max(0, Number(t.count ?? 0) - Number(t.sold_at_vest ?? 0))
    }
    if (((s as any).rsu_grants ?? []).some((g: any) => !g.ended_at)) hasActiveGrant = true
  }
  if (shares <= 0 && !hasActiveGrant) await deleteAsset(assetId)
}

/** Applies the user's lot choice for a held sell, then marks it resolved. */
export async function resolveHeldLotSell(sell: HeldLotSell, allocation: Record<string, number>): Promise<void> {
  const problem = validateAllocation(sell.lots, allocation, sell.quantity)
  if (problem) throw new Error(problem)
  const supabase = getSupabaseClient()
  for (const op of allocationOps(sell.lots, allocation)) {
    const { error } =
      op.kind === 'delete'
        ? await supabase.from('transactions').delete().eq('id', op.lotId)
        : await supabase.from('transactions').update({ count: op.count }).eq('id', op.lotId)
    if (error) throw error
  }
  const { error } = await supabase.from('plaid_synced_transactions').update({ status: 'resolved' }).eq('id', sell.id)
  if (error) throw error
  await removeAssetIfFullySold(sell.assetId)
}

/** Leaves the lots untouched; the position's drift check will then show the difference. */
export async function dismissHeldLotSell(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('plaid_synced_transactions').update({ status: 'skipped' }).eq('id', id)
  if (error) throw error
}

export interface PlaidLotPairing {
  transactionId: string
  plaidDate: string
  plaidPrice: number
}

// Remembers which tracked lot the user paired with which Plaid lot, so the sync can
// still recognise it when their date or cost basis differ slightly from Plaid's.
// Best effort: losing a pairing only means a later sell falls back to manual matching.
export async function savePlaidLotLinks(
  row: Pick<PendingPlaidPosition, 'plaid_item_id' | 'external_account_id' | 'external_security_id'>,
  pairings: PlaidLotPairing[],
): Promise<void> {
  if (pairings.length === 0 || !row.external_security_id) return
  const { error } = await getSupabaseClient().from('plaid_lot_links').insert(
    pairings.map((p) => ({
      plaid_item_id: row.plaid_item_id,
      external_account_id: row.external_account_id,
      external_security_id: row.external_security_id,
      transaction_id: p.transactionId,
      plaid_lot_date: p.plaidDate,
      plaid_lot_price: p.plaidPrice,
    })),
  )
  // 23505: that lot already has a pairing — keep the existing one.
  if (error && error.code !== '23505') console.error('Failed to save Plaid lot pairings', error)
}

export interface LinkedPlaidAsset {
  id: string
  name: string
}

/** Assets a connection has been confirmed into (what "delete linked assets" on disconnect would remove). */
export async function listLinkedAssetsForItem(plaidItemId: string): Promise<LinkedPlaidAsset[]> {
  const { data, error } = await getSupabaseClient()
    .from('plaid_synced_positions')
    .select('asset_id, asset:assets(name)')
    .eq('plaid_item_id', plaidItemId)
    .not('asset_id', 'is', null)
  if (error) throw error
  const seen = new Map<string, LinkedPlaidAsset>()
  for (const r of data ?? []) {
    const id = (r as any).asset_id as string
    if (!seen.has(id)) seen.set(id, { id, name: (r as any).asset?.name ?? 'Asset' })
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Disconnects a connection. By default the assets it was confirmed into are kept
 * (the link rows disappear with the connection); with deleteAssets they're removed
 * too — after the disconnect succeeds, so a failed disconnect never costs you data.
 */
export async function disconnectPlaidItem(
  plaidItemId: string,
  options: { deleteAssets: boolean } = { deleteAssets: false },
): Promise<{ deleted: number; failed: string[] }> {
  const linked = options.deleteAssets ? await listLinkedAssetsForItem(plaidItemId) : []
  await removePlaidItem(plaidItemId)
  let deleted = 0
  const failed: string[] = []
  for (const asset of linked) {
    try {
      await deleteAsset(asset.id)
      deleted += 1
    } catch {
      failed.push(asset.name)
    }
  }
  return { deleted, failed }
}
