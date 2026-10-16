import { test } from '@playwright/test'
import { signedInApp, STOCK_ASSET } from './fakeSupabase'

const mk = (id: string, name: string, type: string, extra: any) => ({ ...STOCK_ASSET, id, name, asset_type: type, ...extra })
const stock2 = (id: string, sym: string, price: number, prev: number, cost: number, n: number, rsu = false) => mk(id, sym, 'Stock', {
  ticker_id: 't-' + id, ticker: { id: 't-' + id, symbol: sym, current_price: price, previous_close: prev, kind: 'stock', ticker_themes: [] },
  stock_subtypes: [{ id: 's-' + id, asset_id: id, subtype: rsu ? 'RSU' : 'Market',
    transactions: [{ id: 'tx-' + id, subtype_id: 's-' + id, count: n, cost_price: cost, purchase_date: '2024-02-01', capital_gains_status: id === 'a3' ? 'Short Term' : 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }],
    rsu_grants: rsu ? [{ id: 'g1', subtype_id: 's-' + id, grant_date: '2024-01-01', total_shares: 400, vest_start: '2024-01-01', vest_end: '2028-01-01', cliff_date: '2025-01-01', vesting_frequency: 'quarterly', ended_at: null }] : [] }],
})
const assets = [
  STOCK_ASSET, stock2('a2', 'NVDA', 900, 880, 400, 12), stock2('a3', 'MSFT', 410, 415, 380, 20), stock2('a4', 'GOOG', 170, 168, 190, 15, true),
  mk('a5', 'Coinbase BTC', 'Crypto', { ticker_id: 't-a5', ticker: { id: 't-a5', symbol: 'BTC', current_price: 65000, previous_close: 64000, kind: 'crypto', ticker_themes: [] },
    stock_subtypes: [{ id: 's-a5', asset_id: 'a5', subtype: 'Market', transactions: [{ id: 'tx5', subtype_id: 's-a5', count: 0.5, cost_price: 30000, purchase_date: '2023-05-01', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }], rsu_grants: [] }] }),
  mk('a6', 'Savings', 'Cash', { ticker_id: null, ticker: null, price: 25000, initial_price: 25000, stock_subtypes: [], location_id: 'loc-2', location: { id: 'loc-2', name: 'Chase', account_type: 'Bank' } }),
  mk('a7', '401k', '401k', { ticker_id: null, ticker: null, price: 80000, initial_price: 70000, stock_subtypes: [], location_id: 'loc-3', location: { id: 'loc-3', name: 'Vanguard', account_type: 'Retirement' } }),
]
const vps = [[1440, 900], [1200, 900], [800, 900], [390, 800]]
for (const scheme of ['dark', 'light'] as const)
  for (const [w, h] of vps)
    for (const path of ['/', '/charts'])
      for (const collapsed of w >= 1200 ? [false, true] : [false])
        test(`${scheme} ${w} ${path} ${collapsed}`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme })
          await page.setViewportSize({ width: w, height: h })
          await page.addInitScript(([s, c]) => { localStorage.setItem('mne_theme', s as string); localStorage.setItem('mne_sidebar_collapsed', String(c)) }, [scheme, collapsed])
          await signedInApp(page, { assets: assets as any })
          await page.goto(path)
          await page.waitForTimeout(2500)
          const name = `${scheme}-${w}-${path === '/' ? 'home' : 'charts'}${collapsed ? '-col' : ''}`
          await page.screenshot({ path: `/tmp/claude-0/shots/${name}.png` })
          await page.evaluate(() => window.scrollTo(0, 99999))
          await page.waitForTimeout(300)
          await page.screenshot({ path: `/tmp/claude-0/shots/${name}-b.png` })
          if (scheme === 'dark' && w === 1440 && !collapsed) {
            await page.evaluate(() => {
              window.scrollTo(0, 0)
              const m = document.querySelector('.mne-masonry')!
              for (let i = 0; i < 2; i++) { const d = document.createElement('div'); d.className = 'mne-masonry-item'; d.innerHTML = `<section class="mne-card" style="height:${160 + i * 90}px">dummy ${i}</section>`; m.appendChild(d) }
            })
            await page.setViewportSize({ width: 1439, height: h })
            await page.waitForTimeout(600)
            await page.screenshot({ path: `/tmp/claude-0/shots/${name}-dummy.png` })
          }
        })
