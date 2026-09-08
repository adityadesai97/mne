import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Same per-item sync logic as plaid-sync (the hourly cron sweep across all
// users), scoped here to a single caller's own items via their JWT. Backs
// the Settings "Sync now" button and the initial pull right after
// plaid-exchange-token connects a new item — without trusting a
// client-supplied user_id the way send-push does today. See
// plaid-create-link-token/index.ts for why this is duplicated rather than
// shared via an import, and plaid-sync/index.ts for the field-shape caveat
// on Plaid's holdings/balance responses. Keep both copies in sync.

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
  if (!res.ok) throw new Error(json.error_message || json.error_code || `Plaid ${path} failed`)
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
    }
  }

  return rows
}

async function syncOneItem(
  supabase: ReturnType<typeof createClient>,
  item: { id: string; user_id: string; item_id: string; institution_name: string | null },
  creds: { clientId: string; secret: string; env: string },
): Promise<number> {
  const { data: secretRow } = await supabase
    .from('plaid_item_secrets')
    .select('access_token')
    .eq('item_id', item.id)
    .maybeSingle()
  if (!secretRow?.access_token) return 0
  const accessToken = secretRow.access_token as string

  let holdingsRes: any
  let balancesRes: any
  try {
    ;[holdingsRes, balancesRes] = await Promise.all([
      plaidFetch(creds, '/investments/holdings/get', { access_token: accessToken }),
      plaidFetch(creds, '/accounts/balance/get', { access_token: accessToken }),
    ])
  } catch (err) {
    await supabase.from('plaid_items').update({ status: 'error' }).eq('id', item.id)
    console.error(`plaid-sync-me: item ${item.id} failed`, err)
    return 0
  }

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
      } else if (row.detected_type === 'stock' && synced.transaction_id) {
        await supabase
          .from('transactions')
          .update({ count: row.payload.count, cost_price: row.payload.cost_price })
          .eq('id', synced.transaction_id)
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

  await supabase.from('plaid_items').update({ status: 'active', last_synced_at: new Date().toISOString() }).eq('id', item.id)
  return pendingCount
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const creds = await getPlaidCredentials(supabase, user.id)
  if (!creds) {
    return new Response(JSON.stringify({ error: 'Plaid credentials not configured.' }), { status: 400 })
  }

  const { data: items } = await supabase
    .from('plaid_items')
    .select('id, user_id, item_id, institution_name')
    .eq('user_id', user.id)

  let pendingCount = 0
  for (const item of items ?? []) {
    pendingCount += await syncOneItem(supabase, item, creds)
  }

  return new Response(JSON.stringify({ ok: true, pendingCount }))
})
