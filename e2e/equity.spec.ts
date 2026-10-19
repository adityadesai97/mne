import { test, expect } from '@playwright/test'
import { signedInApp } from './fakeSupabase'

const PRIVATE = {
  id: 'asset-priv', user_id: 'user-1', name: 'Acme Inc', asset_type: 'Stock', ownership: 'Individual',
  price: null, initial_price: null, location_id: 'loc-1', ticker_id: null, manual_price: 12.5, manual_price_date: '2026-09-01',
  fixed_income_subtype: null, interest_rate: null, maturity_date: null, face_value: null,
  location: { id: 'loc-1', name: 'Carta', account_type: 'Investment' }, ticker: null,
  stock_subtypes: [
    { id: 'sub-m', asset_id: 'asset-priv', subtype: 'Market', transactions: [{ id: 'tx-p', subtype_id: 'sub-m', count: 100, cost_price: 5, purchase_date: '2024-01-02', capital_gains_status: 'Long Term', sold_at_vest: 0, plaid_synced_positions: [] }], rsu_grants: [], esop_grants: [] },
    { id: 'sub-e', asset_id: 'asset-priv', subtype: 'ESOP', transactions: [], rsu_grants: [], esop_grants: [{
      id: 'grant-1', subtype_id: 'sub-e', grant_date: '2020-01-01', total_options: 1000, strike_price: 2, vest_start: '2020-01-01', vest_end: '2022-01-01',
      cliff_date: null, vesting_frequency: 'monthly', expiry_date: '2040-01-01', ended_at: null, esop_exercises: [],
    }] },
  ],
  option_contracts: [], fixed_income_lots: [], plaid_synced_positions: [],
}

test.describe('private company options and listed calls/puts', () => {
  test('a private company shows its manual price, vested options and an exercise action', async ({ page }) => {
    await signedInApp(page, { assets: [PRIVATE as any] })
    await page.goto('/portfolio/asset-priv')
    await expect(page.getByText('Private company')).toBeVisible()
    await expect(page.getByText(/manual · as of/)).toBeVisible()
    // 100 shares × 12.50 + 1000 vested options × (12.50 − 2.00)
    await expect(page.getByText('$11,750').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Exercise options' })).toBeVisible()
    // Calls & puts are for listed stocks only.
    await expect(page.getByText('Calls & puts')).toHaveCount(0)

    // The rest of the app copes with a position that has no ticker.
    for (const path of ['/', '/portfolio', '/charts']) {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      await page.goto(path)
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      expect(errors).toEqual([])
    }
    await page.goto('/portfolio')
    await expect(page.getByText('Acme Inc').first()).toBeVisible()
  })

  test('a listed stock offers calls and puts and values an in-the-money call', async ({ page }) => {
    const stock = {
      ...PRIVATE, id: 'asset-spy', name: 'SPY', ticker_id: 'tick-spy', manual_price: null,
      ticker: { id: 'tick-spy', symbol: 'SPY', current_price: 130, previous_close: 128, kind: 'stock', ticker_themes: [] },
      stock_subtypes: [],
      option_contracts: [{ id: 'c-1', asset_id: 'asset-spy', option_type: 'call', strike_price: 100, expiry_date: '2099-01-01', contracts: 2, multiplier: 100, premium_per_share: 5, purchase_date: '2026-01-01', closed_date: null, close_premium_per_share: null }],
    }
    await signedInApp(page, { assets: [stock as any] })
    await page.goto('/portfolio/asset-spy')
    await expect(page.getByText('Calls & puts')).toBeVisible()
    await expect(page.getByText('$6,000').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add call / put' })).toBeVisible()
  })
})
