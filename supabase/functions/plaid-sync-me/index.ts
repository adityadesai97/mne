import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Same per-item sync logic as plaid-sync (the hourly cron sweep across all
// users), scoped here to a single caller's own items via their JWT. Backs
// the Settings "Sync now" button and the initial pull right after
// plaid-exchange-token connects a new item — without trusting a
// client-supplied user_id the way send-push does today. See
// plaid-create-link-token/index.ts for why this is duplicated rather than
// shared via an import, and plaid-sync/index.ts for the field-shape caveat
// on Plaid's holdings/balance responses. Keep both copies in sync.
//
// Deployed with verify_jwt:false despite being user-invoked — see
// plaid-create-link-token/index.ts for why (the gateway's own JWT check on
// CORS preflight OPTIONS requests breaks browser calls; auth is checked
// manually below instead).

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function plaidBaseUrl(env: string) {
  return env === 'sandbox' ? 'https://sandbox.plaid.com' : 'https://production.plaid.com'
}

async function getPlaidCredentials(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: creds } = await supabase
    .from('plaid_credentials')
    .select('client_id, plaid_env')
    .eq('user_id', userId)
    .maybeSingle()
  const { data: secretRow } = await supabase
    .from('plaid_credential_secrets')
    .select('secret')
    .eq('user_id', userId)
    .maybeSingle()
  if (!creds?.client_id || !secretRow?.secret) return null
  return { clientId: creds.client_id as string, secret: secretRow.secret as string, env: (creds.plaid_env as string) || 'production' }
}

async function plaidFetch(
  creds: { clientId: string; secret: string; env: string },
  path: string,
  body: Record<string, unknown>,
) {
  const res = await fetch(`${plaidBaseUrl(creds.env)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
  })
  const json = await res.json()
  if (!res.ok) {
    const err = new Error(json.error_message || json.error_code || `Plaid ${path} failed`) as Error & { code?: string }
    err.code = json.error_code
    throw err
  }
  return json
}

// Canonical source: src/lib/plaidMatching.ts (unit tested there) —
// reimplemented here since this function can't import from src/. Keep both
// copies (this one and plaid-sync/index.ts's) in sync.
function assetNaturalKey(params: {
  assetType: string
  name: string
  locationName: string
  ownership: string
  tickerSymbol: string | null
  fixedIncomeSubtype: string | null
}): string {
  return [
    params.assetType.trim().toLowerCase(),
    params.name.trim().toLowerCase(),
    params.locationName.trim().toLowerCase(),
    params.ownership.trim().toLowerCase(),
    (params.tickerSymbol ?? '').trim().toLowerCase(),
    (params.fixedIncomeSubtype ?? '').trim().toLowerCase(),
  ].join('::')
}

const RETIREMENT_SUBTYPES = new Set(['401k', '403b', '401a', '457b'])
const BOND_SECURITY_TYPES = new Set(['bond', 'tips', 'bill', 'fixed income'])

interface PendingRow {
  external_account_id: string
  external_security_id: string | null
  detected_type: 'stock' | 'cash' | 'fixed_income' | 'stock_plan'
  payload: Record<string, unknown>
  matched_asset_id: string | null
}

function buildPendingRows(
  institutionName: string,
  accounts: any[],
  holdings: any[],
  securities: any[],
  existingAssetKeys: Map<string, string>,
): PendingRow[] {
  const rows: PendingRow[] = []
  const securityById = new Map(securities.map((s) => [s.security_id, s]))
  const holdingsByAccount = new Map<string, any[]>()
  for (const h of holdings) {
    const list = holdingsByAccount.get(h.account_id) ?? []
    list.push(h)
    holdingsByAccount.set(h.account_id, list)
  }

  for (const account of accounts) {
    const subtype: string | null = account.subtype ?? null
    const accountHoldings = holdingsByAccount.get(account.account_id) ?? []

    if (account.type === 'depository' && accountHoldings.length === 0) {
      const isCd = subtype === 'cd'
      const assetType = isCd ? 'Fixed Income' : 'Cash'
      const name = account.name || account.official_name || institutionName
      const key = assetNaturalKey({
        assetType,
        name,
        locationName: institutionName,
        ownership: 'Individual',
        tickerSymbol: null,
        fixedIncomeSubtype: isCd ? 'CD' : null,
      })
      rows.push({
        external_account_id: account.account_id,
        external_security_id: null,
        detected_type: 'cash',
        payload: {
          name,
          asset_type: assetType,
          ...(isCd ? { fixed_income_subtype: 'CD' } : {}),
          location_name: institutionName,
          account_type: 'Checking',
          ownership: 'Individual',
          price: account.balances?.current ?? null,
        },
        matched_asset_id: existingAssetKeys.get(key) ?? null,
      })
      continue
    }

    if (account.type === 'investment' && subtype && RETIREMENT_SUBTYPES.has(subtype)) {
      const total = accountHoldings.reduce((sum, h) => sum + (h.institution_value ?? 0), 0)
      const name = account.name || account.official_name || `${institutionName} 401k`
      const key = assetNaturalKey({
        assetType: '401k',
        name,
        locationName: institutionName,
        ownership: 'Individual',
        tickerSymbol: null,
        fixedIncomeSubtype: null,
      })
      rows.push({
        external_account_id: account.account_id,
        external_security_id: null,
        detected_type: 'cash',
        payload: {
          name,
          asset_type: '401k',
          location_name: institutionName,
          account_type: 'Investment',
          ownership: 'Individual',
          price: total || account.balances?.current || null,
        },
        matched_asset_id: existingAssetKeys.get(key) ?? null,
      })
      continue
    }

    if (account.type === 'investment' && subtype === 'hsa') {
      const total = accountHoldings.reduce((sum, h) => sum + (h.institution_value ?? 0), 0)
      const name = account.name || account.official_name || `${institutionName} HSA`
      const key = assetNaturalKey({
        assetType: 'HSA',
        name,
        locationName: institutionName,
        ownership: 'Individual',
        tickerSymbol: null,
        fixedIncomeSubtype: null,
      })
      rows.push({
        external_account_id: account.account_id,
        external_security_id: null,
        detected_type: 'cash',
        payload: {
          name,
          asset_type: 'HSA',
          location_name: institutionName,
          account_type: 'Investment',
          ownership: 'Individual',
          price: total || account.balances?.current || null,
        },
        matched_asset_id: existingAssetKeys.get(key) ?? null,
      })
      continue
    }

    if (account.type === 'investment') {
      const looksLikeStockPlan = /rsu|espp|stock plan|equity award/i.test(
        `${account.name ?? ''} ${account.official_name ?? ''}`,
      )

      for (const holding of accountHoldings) {
        const security = securityById.get(holding.security_id)
        if (!security || security.is_cash_equivalent) continue

        const isBond = BOND_SECURITY_TYPES.has((security.type ?? '').toLowerCase())
        const symbol: string | null = security.ticker_symbol ?? null
        const lots = Array.isArray(holding.tax_lots) ? holding.tax_lots : []

        if (isBond) {
          const fixedIncomeSubtype = (security.type ?? '').toLowerCase() === 'bill' ? 'T-Bill' : 'Bond'
          const name = security.name || symbol || 'Bond position'
          const key = assetNaturalKey({
            assetType: 'Fixed Income',
            name,
            locationName: institutionName,
            ownership: 'Individual',
            tickerSymbol: null,
            fixedIncomeSubtype,
          })
          const firstLot = lots[0]
          rows.push({
            external_account_id: account.account_id,
            external_security_id: holding.security_id,
            detected_type: 'fixed_income',
            payload: {
              name,
              asset_type: 'Fixed Income',
              fixed_income_subtype: fixedIncomeSubtype,
              location_name: institutionName,
              account_type: 'Investment',
              ownership: 'Individual',
              count: firstLot?.quantity ?? holding.quantity ?? null,
              cost_price: firstLot?.purchase_price ?? holding.cost_basis ?? null,
              purchase_date: firstLot?.purchase_date ?? null,
              interest_rate: null,
              maturity_date: null,
              face_value: null,
              _lots: lots,
            },
            matched_asset_id: existingAssetKeys.get(key) ?? null,
          })
          continue
        }

        if (!symbol) continue

        const name = `${symbol} Stock`
        const subtypeGuess = looksLikeStockPlan ? 'RSU' : 'Market'
        const key = assetNaturalKey({
          assetType: 'Stock',
          name,
          locationName: institutionName,
          ownership: 'Individual',
          tickerSymbol: symbol,
          fixedIncomeSubtype: null,
        })
        const firstLot = lots[0]
        rows.push({
          external_account_id: account.account_id,
          external_security_id: holding.security_id,
          detected_type: looksLikeStockPlan ? 'stock_plan' : 'stock',
          payload: {
            symbol,
            count: firstLot?.quantity ?? holding.quantity ?? null,
            cost_price: firstLot?.purchase_price ?? holding.cost_basis ?? null,
            purchase_date: firstLot?.purchase_date ?? null,
            subtype: subtypeGuess,
            grant_date: null,
            asset_name: name,
            location_name: institutionName,
            account_type: 'Investment',
            ownership: 'Individual',
            _lots: lots,
          },
          matched_asset_id: existingAssetKeys.get(key) ?? null,
        })
      }

      // Cash sitting in the brokerage account itself. Plaid reports it as
      // is_cash_equivalent holdings, which the loop above deliberately skips;
      // mne tracks it as a flat-balance Cash asset so it stays in sync too.
      const cashHoldings = accountHoldings.filter((h) => securityById.get(h.security_id)?.is_cash_equivalent)
      if (cashHoldings.length > 0) {
        const cashTotal = cashHoldings.reduce((sum, h) => sum + (h.institution_value ?? 0), 0)
        const cashName = `${account.name || account.official_name || institutionName} Cash`
        const cashKey = assetNaturalKey({
          assetType: 'Cash',
          name: cashName,
          locationName: institutionName,
          ownership: 'Individual',
          tickerSymbol: null,
          fixedIncomeSubtype: null,
        })
        rows.push({
          external_account_id: account.account_id,
          external_security_id: null,
          detected_type: 'cash',
          payload: {
            name: cashName,
            asset_type: 'Cash',
            location_name: institutionName,
            account_type: 'Investment',
            ownership: 'Individual',
            price: cashTotal,
          },
          matched_asset_id: existingAssetKeys.get(cashKey) ?? null,
        })
      }
    }
  }

  return rows
}

// ── Ledger sync ─────────────────────────────────────────────────────────────
// Once a Stock position is confirmed and linked (plaid_synced_positions), buys,
// sells, transfers and splits Plaid reports as investment transactions are
// applied to its Market lots automatically; only what can't be applied cleanly
// is left for the user (a shortfall is recorded as `skipped` and surfaces
// through the drift check below). planLedger/computeDrift are a hand-kept port
// of src/lib/plaidLedger.ts (unit tested there) — keep all three copies in sync.

const LOG_PREFIX = 'plaid-sync-me'

interface LedgerLot {
  id: string
  count: number
  cost_price: number
  purchase_date: string
}

interface PlaidInvestmentTxn {
  investment_transaction_id: string
  date: string
  type: string
  subtype?: string | null
  quantity: number | null
  price: number | null
}

type LedgerOp =
  | { kind: 'add_lot'; txnId: string; count: number; cost_price: number; purchase_date: string }
  | { kind: 'update_lot'; txnId: string; lotId: string; count: number; cost_price?: number }
  | { kind: 'delete_lot'; txnId: string; lotId: string }

interface LedgerPlan {
  ops: LedgerOp[]
  applied: string[]
  skipped: Array<{ txnId: string; reason: string }>
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round4 = (n: number) => Math.round(n * 1e4) / 1e4
const EPSILON = 1e-6

interface WorkingLot extends LedgerLot {
  isNew?: boolean
  dirty?: boolean
  deleted?: boolean
  costDirty?: boolean
  txnIds: string[]
}

function planLedger(lots: LedgerLot[], txns: PlaidInvestmentTxn[]): LedgerPlan {
  const working: WorkingLot[] = lots.map((l) => ({
    ...l,
    count: Number(l.count),
    cost_price: Number(l.cost_price),
    txnIds: [],
  }))
  const ops: LedgerOp[] = []
  const applied: string[] = []
  const skipped: Array<{ txnId: string; reason: string }> = []

  const sorted = [...txns].sort((a, b) =>
    a.date === b.date
      ? a.investment_transaction_id.localeCompare(b.investment_transaction_id)
      : a.date.localeCompare(b.date),
  )

  const liveLots = () => working.filter((l) => !l.deleted)
  const totalShares = () => liveLots().reduce((s, l) => s + l.count, 0)

  // Consumes `qty` shares oldest-lot-first (Plaid doesn't say which lot a sell
  // targeted, and FIFO is the brokerage default). All-or-nothing: if the
  // tracked lots can't cover it, nothing changes.
  function consume(txnId: string, qty: number): string | null {
    if (totalShares() + EPSILON < qty) {
      return `only ${round6(totalShares())} shares tracked, transaction reduces ${round6(qty)}`
    }
    let remaining = qty
    const fifo = liveLots().sort((a, b) => a.purchase_date.localeCompare(b.purchase_date))
    for (const lot of fifo) {
      if (remaining <= EPSILON) break
      if (lot.count <= remaining + EPSILON) {
        remaining -= lot.count
        lot.deleted = true
        lot.dirty = true
        lot.txnIds.push(txnId)
      } else {
        lot.count = round6(lot.count - remaining)
        remaining = 0
        lot.dirty = true
        lot.txnIds.push(txnId)
      }
    }
    return null
  }

  for (const txn of sorted) {
    const id = txn.investment_transaction_id
    const type = (txn.type ?? '').toLowerCase()
    const subtype = (txn.subtype ?? '').toLowerCase()
    const qty = Number(txn.quantity ?? 0)

    const isSplit = subtype === 'split' || subtype === 'stock split'
    const affectsShares = type === 'buy' || type === 'sell' || type === 'transfer' || isSplit
    if (!affectsShares || !Number.isFinite(qty) || Math.abs(qty) < EPSILON) continue

    if (isSplit) {
      // Plaid reports the shares *added* by the split. Scale every lot so
      // total shares rise by that amount while each lot's total cost basis
      // stays unchanged.
      const before = totalShares()
      if (qty <= 0 || before <= EPSILON) {
        skipped.push({ txnId: id, reason: 'split with nothing tracked to split' })
        continue
      }
      const ratio = (before + qty) / before
      for (const lot of liveLots()) {
        lot.count = round6(lot.count * ratio)
        lot.cost_price = round4(lot.cost_price / ratio)
        lot.dirty = true
        lot.costDirty = true
        lot.txnIds.push(id)
      }
      applied.push(id)
      continue
    }

    const isIncrease = type === 'buy' ? true : type === 'sell' ? false : qty > 0
    const amount = Math.abs(qty)

    if (isIncrease) {
      const price = txn.price == null ? NaN : Number(txn.price)
      if (!Number.isFinite(price) || price < 0) {
        skipped.push({ txnId: id, reason: 'no usable price to cost the new lot' })
        continue
      }
      working.push({
        id: `new:${id}`,
        count: round6(amount),
        cost_price: round4(price),
        purchase_date: txn.date,
        isNew: true,
        txnIds: [id],
      })
      applied.push(id)
    } else {
      const problem = consume(id, amount)
      if (problem) {
        skipped.push({ txnId: id, reason: problem })
        continue
      }
      applied.push(id)
    }
  }

  for (const lot of working) {
    const txnId = lot.txnIds[0]
    if (lot.isNew) {
      if (lot.deleted) continue // bought then fully sold within the window
      ops.push({
        kind: 'add_lot',
        txnId: txnId,
        count: lot.count,
        cost_price: lot.cost_price,
        purchase_date: lot.purchase_date,
      })
    } else if (lot.dirty) {
      if (lot.deleted) ops.push({ kind: 'delete_lot', txnId, lotId: lot.id })
      else
        ops.push({
          kind: 'update_lot',
          txnId,
          lotId: lot.id,
          count: lot.count,
          ...(lot.costDirty ? { cost_price: lot.cost_price } : {}),
        })
    }
  }

  return { ops, applied, skipped }
}

const DRIFT_TOLERANCE_SHARES = 0.0001

// Positive = Plaid reports more shares than mne tracks. `plaidShares` null means
// we couldn't read Plaid's holdings this run, so nothing is known — no drift.
function computeDrift(trackedShares: number, plaidShares: number | null): number | null {
  if (plaidShares == null) return null
  const diff = round6(plaidShares - trackedShares)
  return Math.abs(diff) < DRIFT_TOLERANCE_SHARES ? 0 : diff
}


function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function check(res: { error: { message: string } | null }) {
  if (res.error) throw new Error(res.error.message)
}

async function markItemError(supabase: ReturnType<typeof createClient>, itemId: string, err: unknown) {
  const code = (err as { code?: string } | null)?.code
  const message = err instanceof Error ? err.message : String(err)
  const text = (code && !message.includes(code) ? `${code}: ${message}` : message).slice(0, 300)
  await supabase.from('plaid_items').update({ status: 'error', last_error: text }).eq('id', itemId)
}

async function fetchInvestmentTransactions(
  creds: { clientId: string; secret: string; env: string },
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const all: any[] = []
  let offset = 0
  while (true) {
    const res = await plaidFetch(creds, '/investments/transactions/get', {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: 500, offset },
    })
    const page: any[] = res.investment_transactions ?? []
    all.push(...page)
    offset += page.length
    if (page.length === 0 || offset >= (res.total_investment_transactions ?? 0)) break
  }
  return all
}

// Mirrors sell_shares in src/lib/claude.ts: a stock asset with no shares left
// and no active RSU grant is removed, and its ticker goes back to watchlist-only
// when nothing else holds it. Returns true if the asset was removed.
async function removeAssetIfFullySold(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  asset: { id: string; ticker_id: string | null },
): Promise<boolean> {
  const { data: subtypes, error } = await supabase
    .from('stock_subtypes')
    .select('transactions(count, sold_at_vest), rsu_grants(id, ended_at)')
    .eq('asset_id', asset.id)
  if (error) throw new Error(error.message)
  let shares = 0
  let hasActiveGrant = false
  for (const s of subtypes ?? []) {
    for (const t of (s as any).transactions ?? []) {
      shares += Math.max(0, Number(t.count ?? 0) - Number(t.sold_at_vest ?? 0))
    }
    if (((s as any).rsu_grants ?? []).some((g: any) => !g.ended_at)) hasActiveGrant = true
  }
  if (shares > 0 || hasActiveGrant) return false

  check(await supabase.from('assets').delete().eq('id', asset.id))
  if (asset.ticker_id) {
    const { count } = await supabase
      .from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ticker_id', asset.ticker_id)
      .in('asset_type', ['Stock', 'Crypto'])
    if ((count ?? 0) === 0) {
      await supabase.from('tickers').update({ watchlist_only: true }).eq('id', asset.ticker_id)
    }
  }
  return true
}

async function applyLedgerForPosition(
  supabase: ReturnType<typeof createClient>,
  item: { id: string; user_id: string },
  pos: { created_at: string },
  asset: { id: string; ticker_id: string | null },
  txns: any[],
): Promise<boolean> {
  // Only what happened after the position was linked: anything earlier is
  // already reflected in the lots the user confirmed. A same-day trade that
  // landed after linking is picked up by the drift check instead.
  const baseline = pos.created_at.slice(0, 10)
  const candidates = txns.filter((t) => t.date > baseline)
  if (candidates.length === 0) return false

  const ids: string[] = candidates.map((t) => t.investment_transaction_id)
  const seen = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('plaid_synced_transactions')
      .select('investment_transaction_id')
      .eq('plaid_item_id', item.id)
      .in('investment_transaction_id', ids.slice(i, i + 200))
    for (const r of data ?? []) seen.add(r.investment_transaction_id)
  }
  const fresh = candidates.filter((t) => !seen.has(t.investment_transaction_id))
  if (fresh.length === 0) return false

  const { data: marketSubtype } = await supabase
    .from('stock_subtypes')
    .select('id')
    .eq('asset_id', asset.id)
    .eq('subtype', 'Market')
    .maybeSingle()
  let lots: LedgerLot[] = []
  if (marketSubtype) {
    const { data } = await supabase
      .from('transactions')
      .select('id, count, cost_price, purchase_date')
      .eq('subtype_id', marketSubtype.id)
    lots = (data ?? []) as LedgerLot[]
  }

  const plan = planLedger(
    lots,
    fresh.map((t) => ({
      investment_transaction_id: t.investment_transaction_id,
      date: t.date,
      type: t.type,
      subtype: t.subtype ?? null,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
    })),
  )

  // Recorded before the writes so a retry after a crash can't apply twice; the
  // applied rows are rolled back below if the writes themselves fail.
  const ledgerRows = [
    ...plan.applied.map((id) => ({
      plaid_item_id: item.id,
      investment_transaction_id: id,
      asset_id: asset.id,
      status: 'applied',
    })),
    ...plan.skipped.map((s) => ({
      plaid_item_id: item.id,
      investment_transaction_id: s.txnId,
      asset_id: asset.id,
      status: 'skipped',
      reason: s.reason,
    })),
  ]
  if (ledgerRows.length > 0) {
    check(
      await supabase
        .from('plaid_synced_transactions')
        .upsert(ledgerRows, { onConflict: 'plaid_item_id,investment_transaction_id', ignoreDuplicates: true }),
    )
  }

  try {
    let subtypeId: string | undefined = marketSubtype?.id
    for (const op of plan.ops) {
      if (op.kind === 'add_lot') {
        if (!subtypeId) {
          const { data, error } = await supabase
            .from('stock_subtypes')
            .insert({ asset_id: asset.id, subtype: 'Market' })
            .select('id')
            .single()
          if (error) throw new Error(error.message)
          subtypeId = data.id as string
        }
        check(
          await supabase.from('transactions').insert({
            subtype_id: subtypeId,
            count: op.count,
            cost_price: op.cost_price,
            purchase_date: op.purchase_date,
            capital_gains_status: 'Short Term',
          }),
        )
      } else if (op.kind === 'update_lot') {
        check(
          await supabase
            .from('transactions')
            .update({ count: op.count, ...(op.cost_price != null ? { cost_price: op.cost_price } : {}) })
            .eq('id', op.lotId),
        )
      } else {
        check(await supabase.from('transactions').delete().eq('id', op.lotId))
      }
    }
  } catch (err) {
    if (plan.applied.length > 0) {
      await supabase
        .from('plaid_synced_transactions')
        .delete()
        .eq('plaid_item_id', item.id)
        .in('investment_transaction_id', plan.applied)
    }
    throw err
  }

  if (plan.ops.length === 0) return false
  return await removeAssetIfFullySold(supabase, item.user_id, asset)
}

async function recordDrift(
  supabase: ReturnType<typeof createClient>,
  pos: { id: string; asset_id: string },
  holding: { quantity: number; costBasis: number | null } | undefined,
) {
  const { data: subtypes } = await supabase
    .from('stock_subtypes')
    .select('transactions(count, sold_at_vest)')
    .eq('asset_id', pos.asset_id)
  let tracked = 0
  for (const s of subtypes ?? []) {
    for (const t of (s as any).transactions ?? []) {
      tracked += Math.max(0, Number(t.count ?? 0) - Number(t.sold_at_vest ?? 0))
    }
  }
  const plaidShares = holding ? holding.quantity : 0
  await supabase
    .from('plaid_synced_positions')
    .update({
      plaid_quantity: plaidShares,
      // Plaid's holding cost_basis is the holding's total, so per share = total / quantity.
      plaid_cost_price:
        holding && holding.quantity > 0 && holding.costBasis != null ? holding.costBasis / holding.quantity : null,
      drift_shares: computeDrift(tracked, plaidShares),
      checked_at: new Date().toISOString(),
    })
    .eq('id', pos.id)
}

async function syncLedger(
  supabase: ReturnType<typeof createClient>,
  item: { id: string; user_id: string; txn_synced_through?: string | null },
  creds: { clientId: string; secret: string; env: string },
  accessToken: string,
  holdings: any[],
) {
  const { data: linked } = await supabase
    .from('plaid_synced_positions')
    .select('id, external_account_id, external_security_id, asset_id, created_at')
    .eq('plaid_item_id', item.id)
    .not('asset_id', 'is', null)
    .not('external_security_id', 'is', null)
  if (!linked || linked.length === 0) return

  const { data: assets } = await supabase
    .from('assets')
    .select('id, asset_type, ticker_id')
    .in('id', linked.map((l: any) => l.asset_id))
  const stockAssets = new Map<string, { id: string; ticker_id: string | null }>(
    (assets ?? []).filter((a: any) => a.asset_type === 'Stock').map((a: any) => [a.id, a]),
  )
  const positions = linked.filter((l: any) => stockAssets.has(l.asset_id))
  if (positions.length === 0) return

  const today = new Date().toISOString().slice(0, 10)
  const earliestLink = positions.map((p: any) => String(p.created_at).slice(0, 10)).sort()[0]
  const floor = shiftDate(today, -700) // Plaid keeps ~24 months of history
  const wanted = item.txn_synced_through ? shiftDate(item.txn_synced_through, -7) : earliestLink
  const startDate = wanted < floor ? floor : wanted

  let txns: any[] = []
  let txnsFetched = false
  try {
    txns = await fetchInvestmentTransactions(creds, accessToken, startDate, today)
    txnsFetched = true
  } catch (err) {
    console.error(`${LOG_PREFIX}: item ${item.id} investment transactions failed`, err)
    const code = (err as { code?: string } | null)?.code
    // Transient (data not ready yet, or no response at all): leave everything as
    // is. Anything else means this institution has no transaction feed, so the
    // drift check alone keeps its positions honest.
    if (!code || code === 'PRODUCT_NOT_READY') return
  }

  const holdingByKey = new Map<string, { quantity: number; costBasis: number | null }>()
  for (const h of holdings) {
    const key = `${h.account_id}::${h.security_id}`
    const prev = holdingByKey.get(key) ?? { quantity: 0, costBasis: null }
    prev.quantity += Number(h.quantity ?? 0)
    if (h.cost_basis != null) prev.costBasis = (prev.costBasis ?? 0) + Number(h.cost_basis)
    holdingByKey.set(key, prev)
  }
  const txnsByKey = new Map<string, any[]>()
  for (const t of txns) {
    const key = `${t.account_id}::${t.security_id}`
    const list = txnsByKey.get(key) ?? []
    list.push(t)
    txnsByKey.set(key, list)
  }

  for (const pos of positions) {
    const asset = stockAssets.get(pos.asset_id)!
    const key = `${pos.external_account_id}::${pos.external_security_id}`
    let removed = false
    try {
      removed = await applyLedgerForPosition(supabase, item, pos, asset, txnsByKey.get(key) ?? [])
    } catch (err) {
      console.error(`${LOG_PREFIX}: item ${item.id} ledger for asset ${asset.id} failed`, err)
    }
    if (removed) continue
    await recordDrift(supabase, pos, holdingByKey.get(key))
  }

  if (txnsFetched) {
    await supabase.from('plaid_items').update({ txn_synced_through: today }).eq('id', item.id)
  }
}

async function syncOneItem(
  supabase: ReturnType<typeof createClient>,
  item: { id: string; user_id: string; item_id: string; institution_name: string | null; txn_synced_through?: string | null },
  creds: { clientId: string; secret: string; env: string },
): Promise<number> {
  const { data: secretRow } = await supabase
    .from('plaid_item_secrets')
    .select('access_token')
    .eq('item_id', item.id)
    .maybeSingle()
  if (!secretRow?.access_token) return 0
  const accessToken = secretRow.access_token as string

  // Each call is best-effort on its own: a bank-only item has no holdings, and
  // an investments-only login can refuse the live balance call (Chase does,
  // ITEM_LOGIN_REQUIRED) while holdings still come back fine. Only when both
  // fail is the item itself marked as needing attention.
  const [holdingsSettled, balancesSettled] = await Promise.allSettled([
    plaidFetch(creds, '/investments/holdings/get', { access_token: accessToken }),
    plaidFetch(creds, '/accounts/balance/get', { access_token: accessToken }),
  ])
  if (holdingsSettled.status === 'rejected' && balancesSettled.status === 'rejected') {
    await markItemError(supabase, item.id, holdingsSettled.reason)
    console.error(`plaid-sync-me: item ${item.id} failed`, holdingsSettled.reason, balancesSettled.reason)
    return 0
  }
  const holdingsOk = holdingsSettled.status === 'fulfilled'
  const holdingsRes: any = holdingsOk ? holdingsSettled.value : { accounts: [], holdings: [], securities: [] }
  const balancesRes: any = balancesSettled.status === 'fulfilled' ? balancesSettled.value : { accounts: [] }

  const institutionName = item.institution_name || 'Connected account'
  const accountsById = new Map<string, any>()
  for (const a of holdingsRes.accounts ?? []) accountsById.set(a.account_id, a)
  for (const a of balancesRes.accounts ?? []) if (!accountsById.has(a.account_id)) accountsById.set(a.account_id, a)

  const { data: existingAssets } = await supabase
    .from('assets')
    .select('id, asset_type, name, ownership, fixed_income_subtype, location:locations(name), ticker:tickers(symbol)')
    .eq('user_id', item.user_id)

  const existingAssetKeys = new Map<string, string>()
  for (const a of existingAssets ?? []) {
    const key = assetNaturalKey({
      assetType: a.asset_type,
      name: a.name,
      locationName: (a.location as any)?.name ?? '',
      ownership: a.ownership,
      tickerSymbol: (a.ticker as any)?.symbol ?? null,
      fixedIncomeSubtype: a.fixed_income_subtype,
    })
    existingAssetKeys.set(key, a.id)
  }

  const rows = buildPendingRows(
    institutionName,
    Array.from(accountsById.values()),
    holdingsRes.holdings ?? [],
    holdingsRes.securities ?? [],
    existingAssetKeys,
  )

  let pendingCount = 0
  for (const row of rows) {
    const { data: synced } = await supabase
      .from('plaid_synced_positions')
      .select('id, asset_id, transaction_id, fixed_income_lot_id')
      .eq('plaid_item_id', item.id)
      .eq('external_account_id', row.external_account_id)
      .eq('external_security_id', row.external_security_id ?? '')
      .maybeSingle()

    if (synced) {
      if (row.detected_type === 'cash' && synced.asset_id && row.payload.price != null) {
        await supabase.from('assets').update({ price: row.payload.price }).eq('id', synced.asset_id)
      } else if (row.detected_type === 'fixed_income' && synced.fixed_income_lot_id) {
        await supabase
          .from('fixed_income_lots')
          .update({ count: row.payload.count, cost_price: row.payload.cost_price })
          .eq('id', synced.fixed_income_lot_id)
      }
      continue
    }

    const { data: existingPending } = await supabase
      .from('plaid_pending_positions')
      .select('id')
      .eq('plaid_item_id', item.id)
      .eq('external_account_id', row.external_account_id)
      .eq('external_security_id', row.external_security_id ?? '')
      .eq('status', 'pending')
      .maybeSingle()

    if (existingPending) {
      await supabase
        .from('plaid_pending_positions')
        .update({ payload: row.payload, matched_asset_id: row.matched_asset_id })
        .eq('id', existingPending.id)
    } else {
      await supabase.from('plaid_pending_positions').insert({
        user_id: item.user_id,
        plaid_item_id: item.id,
        external_account_id: row.external_account_id,
        external_security_id: row.external_security_id,
        detected_type: row.detected_type,
        payload: row.payload,
        matched_asset_id: row.matched_asset_id,
        status: 'pending',
      })
    }
    pendingCount += 1
  }

  // Stock/crypto lots of linked positions are kept current from Plaid's
  // transaction feed rather than overwritten from the holdings snapshot.
  // Skipped when holdings couldn't be read, so a failed call is never mistaken
  // for "Plaid reports zero shares".
  if (holdingsOk) {
    try {
      await syncLedger(supabase, item, creds, accessToken, holdingsRes.holdings ?? [])
    } catch (err) {
      console.error(`plaid-sync-me: item ${item.id} ledger sync failed`, err)
    }
  }

  await supabase
    .from('plaid_items')
    .update({ status: 'active', last_error: null, last_synced_at: new Date().toISOString() })
    .eq('id', item.id)
  return pendingCount
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const creds = await getPlaidCredentials(supabase, user.id)
  if (!creds) {
    return jsonResponse({ error: 'Plaid credentials not configured.' }, 400)
  }

  const { data: items } = await supabase
    .from('plaid_items')
    .select('id, user_id, item_id, institution_name, txn_synced_through')
    .eq('user_id', user.id)

  let pendingCount = 0
  for (const item of items ?? []) {
    pendingCount += await syncOneItem(supabase, item, creds)
  }

  return jsonResponse({ ok: true, pendingCount })
})
