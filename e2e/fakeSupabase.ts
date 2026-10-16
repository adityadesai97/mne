import type { Page, Route } from '@playwright/test'

export const SUPABASE_URL = 'https://e2e.supabase.test'
export const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e@example.com' }

type Row = Record<string, unknown>
export interface FakeDb {
  tables: Record<string, Row[]>
  /** Every non-GET REST call and rpc, in order, for assertions. */
  calls: { method: string; path: string; body: unknown }[]
}

export const STOCK_ASSET = {
  id: 'asset-1',
  user_id: USER.id,
  name: 'Apple',
  asset_type: 'Stock',
  ownership: 'Individual',
  price: null,
  initial_price: null,
  location_id: 'loc-1',
  ticker_id: 'tick-1',
  fixed_income_subtype: null,
  interest_rate: null,
  maturity_date: null,
  face_value: null,
  location: { id: 'loc-1', name: 'Fidelity', account_type: 'Investment' },
  ticker: { id: 'tick-1', symbol: 'AAPL', current_price: 200, previous_close: 195, kind: 'stock', ticker_themes: [] },
  stock_subtypes: [{
    id: 'sub-1', asset_id: 'asset-1', subtype: 'Market',
    transactions: [{ id: 'tx-1', subtype_id: 'sub-1', count: 10, cost_price: 150, purchase_date: '2023-01-02', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }],
    rsu_grants: [],
  }],
  fixed_income_lots: [],
  plaid_synced_positions: [],
}

/**
 * Signs the page in (session in localStorage, the keys flagged as saved) and
 * answers every Supabase call locally. Returns the fake database so a test can
 * seed rows and inspect what the app wrote.
 */
export async function signedInApp(page: Page, tables: Record<string, Row[]> = {}): Promise<FakeDb> {
  const db: FakeDb = { tables: { assets: [STOCK_ASSET], ...tables }, calls: [] }

  await page.addInitScript(({ user, url }) => {
    const host = new URL(url).hostname.split('.')[0]
    const session = {
      access_token: 'e2e.access.token', refresh_token: 'e2e-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' },
    }
    localStorage.setItem(`sb-${host}-auth-token`, JSON.stringify(session))
    localStorage.setItem('mne_llm_key_set', 'true')
    localStorage.setItem('mne_finnhub_key_set', 'true')
    localStorage.setItem('mne_plaid_onboarding_seen', 'true')
  }, { user: USER, url: SUPABASE_URL })

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })

  await page.route(`${SUPABASE_URL}/**`, async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    }
    if (url.pathname.startsWith('/auth/v1/user')) {
      return json(route, { id: USER.id, email: USER.email, aud: 'authenticated', role: 'authenticated' })
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(route, {})
    if (url.pathname.startsWith('/functions/v1/')) return json(route, {})
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      db.calls.push({ method: req.method(), path: url.pathname, body: req.postDataJSON() })
      return json(route, null)
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.replace('/rest/v1/', '')
      if (req.method() !== 'GET') {
        db.calls.push({ method: req.method(), path: url.pathname, body: req.postDataJSON?.() })
        return json(route, [], req.method() === 'POST' ? 201 : 200)
      }
      const rows = db.tables[table] ?? []
      if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
        return rows.length ? json(route, rows[0]) : json(route, { code: 'PGRST116', message: 'no rows' }, 406)
      }
      return json(route, rows)
    }
    return json(route, {})
  })

  return db
}
