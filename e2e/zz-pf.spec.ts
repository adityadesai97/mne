import { test } from '@playwright/test'
import { signedInApp, STOCK_ASSET, USER } from './fakeSupabase'

const base = { user_id: USER.id, ownership: 'Individual', price: null, initial_price: null, ticker_id: null, ticker: null, fixed_income_subtype: null, interest_rate: null, maturity_date: null, face_value: null, stock_subtypes: [], fixed_income_lots: [], plaid_synced_positions: [], location_id: 'loc-1', location: { id: 'loc-1', name: 'Fidelity', account_type: 'Investment' } }
const assets = [
  { ...STOCK_ASSET, ticker: { ...STOCK_ASSET.ticker, logo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="black"/></svg>' }, plaid_synced_positions: [{ id: 'p1', plaid_item: { institution_name: 'Fidelity', last_synced_at: null } }],
    stock_subtypes: [{ ...STOCK_ASSET.stock_subtypes[0] }, { id: 'sub-2', asset_id: 'asset-1', subtype: 'RSU', transactions: [{ id: 'tx-2', subtype_id: 'sub-2', count: 5, cost_price: 100, purchase_date: '2024-01-02', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }], rsu_grants: [] }] },
  { ...base, id: 'a2', name: 'Bitcoin', asset_type: 'Crypto', ownership: 'Joint', ticker_id: 't2', ticker: { id: 't2', symbol: 'BTC', current_price: 60000, previous_close: 59000, kind: 'crypto', ticker_themes: [] }, stock_subtypes: [{ id: 's3', asset_id: 'a2', subtype: 'Market', transactions: [{ id: 'tx3', subtype_id: 's3', count: 0.5, cost_price: 30000, purchase_date: '2023-01-02', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }], rsu_grants: [] }] },
  { ...base, id: 'a3', name: 'Savings', asset_type: 'Cash', price: 5000 },
  { ...base, id: 'a4', name: '401k', asset_type: '401k', price: 90000 },
  { ...base, id: 'a5', name: 'T-Bill Aug', asset_type: 'Fixed Income', fixed_income_subtype: 'T-Bill', face_value: 1000, maturity_date: '2027-01-01', fixed_income_lots: [{ id: 'l1', asset_id: 'a5', count: 5, cost_price: 980, purchase_date: '2026-01-01', plaid_synced_positions: [] }] },
]
for (const theme of ['dark', 'light']) for (const [w, h] of [[1200, 900], [390, 800]]) {
  test(`pf ${theme} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.addInitScript((t) => { localStorage.setItem('mne_theme', t) }, theme)
    await signedInApp(page, { assets })
    for (const v of ['grid', 'list']) {
      await page.addInitScript((v) => localStorage.setItem('mne_asset_view', v), v)
    }
    await page.goto('/portfolio'); await page.waitForTimeout(1200)
    await page.screenshot({ path: `/tmp/claude-0/shots/pfx-${theme}-${w}-a.png`, fullPage: true })
    await page.getByRole('button', { name: 'Asset view' }).click()
    await page.getByRole('option', { name: /List/ }).click()
    await page.getByRole('button', { name: 'Sort by' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `/tmp/claude-0/shots/pfx-${theme}-${w}-b.png`, fullPage: true })
    const p2 = await page.context().newPage(); await p2.setViewportSize({ width: w, height: h }); await p2.addInitScript((t) => { localStorage.setItem('mne_theme', t) }, theme)
    await signedInApp(p2, { assets: [assets[0]] })
    await p2.goto('/portfolio/asset-1'); await p2.waitForTimeout(1000)
    await p2.getByRole('button', { name: 'Add Lot' }).click()
    await p2.getByRole('button', { name: 'Save' }).click()
    await p2.screenshot({ path: `/tmp/claude-0/shots/adx-${theme}-${w}.png` }); await p2.getByRole('button', { name: 'Add Lot' }).count(); await p2.evaluate(() => document.querySelector('main')?.scrollTo(0, 99999)); await p2.screenshot({ path: `/tmp/claude-0/shots/adx-${theme}-${w}-end.png` })
  })
}
