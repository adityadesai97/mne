import { test } from '@playwright/test'
import { signedInApp, STOCK_ASSET, USER } from './fakeSupabase'

const syms: [string, number, number, number, string][] = [
  ['AAPL', 200, 150, 10, 'Tech'], ['NVDA', 900, 300, 5, 'Semis'], ['TSLA', 180, 260, 8, 'Auto'],
  ['MSFT', 420, 410, 3, 'Tech'], ['VTI', 250, 249, 20, 'Index'], ['XOM', 110, 109.5, 1, 'Energy'], ['AMZN', 180, 120, 6, 'Tech'],
]
function mk(i: number, [sym, cur, cost, n, theme]: typeof syms[number]) {
  return {
    ...STOCK_ASSET, id: `a${i}`, name: sym, ticker_id: `t${i}`, location: { id: 'l', name: i % 2 ? 'Fidelity' : 'Robinhood', account_type: 'Investment' },
    ticker: { id: `t${i}`, symbol: sym, current_price: cur, previous_close: cur, kind: 'stock', ticker_themes: [{ theme: { name: theme } }] },
    stock_subtypes: [{ id: `s${i}`, asset_id: `a${i}`, subtype: 'Market', rsu_grants: [], transactions: [{ id: `x${i}`, subtype_id: `s${i}`, count: n, cost_price: cost, purchase_date: '2023-01-02', capital_gains_status: i % 2 ? 'Long Term' : 'Short Term', sold_at_vest: 0, plaid_synced_positions: [] }] }],
  }
}
const rsu = {
  ...STOCK_ASSET, id: 'r1', name: 'Google', ticker_id: 'tg',
  ticker: { id: 'tg', symbol: 'GOOGL', current_price: 170, previous_close: 170, kind: 'stock', ticker_themes: [] },
  stock_subtypes: [{ id: 'sr', asset_id: 'r1', subtype: 'RSU', transactions: [{ id: 'xr', subtype_id: 'sr', count: 40, cost_price: 100, purchase_date: '2025-01-01', capital_gains_status: 'Short Term', sold_at_vest: 0, plaid_synced_positions: [] }],
    rsu_grants: [{ id: 'g1', subtype_id: 'sr', total_shares: 160, grant_date: '2025-01-01', vest_start: '2025-01-01', vest_end: '2029-01-01', cliff_date: '2026-01-01', vesting_frequency: 'quarterly', ended_at: null }] }],
}
const cash = { ...STOCK_ASSET, id: 'c1', name: 'Savings', asset_type: 'Cash', ticker_id: null, ticker: null, price: 5000, stock_subtypes: [] }

for (const [name, vp, scheme] of [['d12', { width: 1200, height: 900 }, 'dark'], ['l12', { width: 1200, height: 900 }, 'light'], ['d39', { width: 390, height: 800 }, 'dark'], ['l39', { width: 390, height: 800 }, 'light']] as const) {
  test(`charts ${name}`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.emulateMedia({ colorScheme: scheme })
    await signedInApp(page, {
      assets: [...syms.map((s, i) => mk(i, s)), rsu, cash],
      themes: [{ id: 'th1', name: 'Tech', theme_targets: [{ target_percentage: 30 }] }, { id: 'th2', name: 'Semis', theme_targets: [{ target_percentage: 10 }] }],
    })
    await page.addInitScript((s) => localStorage.setItem('mne_theme', s), scheme)
    await page.goto('/charts')
    await page.waitForSelector('.mne-bento')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `/tmp/claude-0/shots/charts-${name}.png`, fullPage: true })
    if (name === 'd12') {
      await page.getByRole('button', { name: 'Subtypes' }).click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `/tmp/claude-0/shots/charts-menu.png` })
    }
  })
}
