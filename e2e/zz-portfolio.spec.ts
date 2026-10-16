import { test } from '@playwright/test'
import { signedInApp, STOCK_ASSET, USER } from './fakeSupabase'

const rich = {
  ...STOCK_ASSET, id: 'a1', name: 'Vanguard Total Market', ownership: 'Joint',
  ticker: { ...STOCK_ASSET.ticker, symbol: 'VTI', current_price: 240, previous_close: 237.8 },
  plaid_synced_positions: [{ id: 'p1', plaid_items: { institution_name: 'Fidelity' } }],
  stock_subtypes: [
    { id: 's1', asset_id: 'a1', subtype: 'Market', rsu_grants: [], transactions: [
      { id: 't1', subtype_id: 's1', count: 20, cost_price: 210.4, purchase_date: '2025-03-03', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] },
      { id: 't2', subtype_id: 's1', count: 12, cost_price: 236.15, purchase_date: '2026-06-18', capital_gains_status: 'Short Term', sold_at_vest: 0, plaid_synced_positions: [] },
    ] },
    { id: 's2', asset_id: 'a1', subtype: 'RSU', transactions: [
      { id: 't3', subtype_id: 's2', count: 10, cost_price: 200, purchase_date: '2026-01-02', capital_gains_status: 'Short Term', sold_at_vest: 3, plaid_synced_positions: [], rsu_grant_id: 'g1' }],
      rsu_grants: [{ id: 'g1', subtype_id: 's2', grant_date: '2025-01-02', vest_start: '2025-01-02', vest_end: '2029-01-02', total_shares: 100, ended_at: null }] },
  ],
}
const nvda = { ...STOCK_ASSET, id: 'a2', name: 'NVIDIA', ticker: { ...STOCK_ASSET.ticker, id: 't2', symbol: 'NVDA', current_price: 120, previous_close: 122.5 } }
const cash = { ...STOCK_ASSET, id: 'a3', name: 'Chase Checking', asset_type: 'Cash', ownership: 'Joint', ticker_id: null, ticker: null, price: 18200, stock_subtypes: [], location: { id: 'l2', name: 'Chase', account_type: 'Bank' } }
const bill = { ...STOCK_ASSET, id: 'a4', name: '26-week T-bill', asset_type: 'Fixed Income', fixed_income_subtype: 'T-Bill', ticker_id: null, ticker: null, price: null, face_value: 1000, maturity_date: '2027-02-12', stock_subtypes: [],
  fixed_income_lots: [{ id: 'f1', asset_id: 'a4', count: 488, cost_price: 987.53, purchase_date: '2026-08-12' }] }

for (const theme of ['dark', 'light']) for (const [w, h] of [[1200, 900], [390, 800]]) {
  test(`shots ${theme} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.addInitScript(t => localStorage.setItem('mne_theme', t), theme)
    const db = await signedInApp(page)
    db.tables.assets = [rich, nvda, cash, bill] as any
    await page.goto('/portfolio')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `/tmp/claude-0/shots/pf-grid-${theme}-${w}.png`, fullPage: true })
    await page.getByRole('button', { name: 'List' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `/tmp/claude-0/shots/pf-list-${theme}-${w}.png`, fullPage: true })
    await page.goto('/portfolio/a1')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /^RSU/ }).first().click().catch(() => {})
    await page.screenshot({ path: `/tmp/claude-0/shots/ad-stock-${theme}-${w}.png`, fullPage: true })
    db.tables.assets = [bill, rich] as any
    await page.goto('/portfolio/a4')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `/tmp/claude-0/shots/ad-bill-${theme}-${w}.png`, fullPage: true })
  })
}
void USER
