import { expect, test } from '@playwright/test'
import { signedInApp } from './fakeSupabase'

const STOCKS = { count: 4, result: [
  { description: 'APPLE HOSPITALITY REIT INC', displaySymbol: 'APLE', symbol: 'APLE', type: 'REIT' },
  { description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
  { description: 'APPLE INC', displaySymbol: 'AAPL.SW', symbol: 'AAPL.SW', type: 'Common Stock' },
  { description: 'ISHARES APPLE ETF', displaySymbol: 'APLY', symbol: 'APLY', type: 'ETP' },
] }
const COINS = { coins: [
  { id: 'wrapped-bitcoin', name: 'Wrapped Bitcoin', symbol: 'WBTC', market_cap_rank: 15 },
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', market_cap_rank: 1 },
] }

for (const [scheme, vp] of [['dark', { width: 1200, height: 900 }], ['light', { width: 390, height: 800 }], ['light', { width: 1200, height: 900 }], ['dark', { width: 390, height: 800 }]] as const) {
  test(`suggestions ${scheme} ${vp.width}`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.emulateMedia({ colorScheme: scheme })
    await signedInApp(page)
    await page.addInitScript(s => localStorage.setItem('mne_theme', s), scheme)
    await page.route('**/functions/v1/market-proxy', async route => {
      const b = route.request().postDataJSON()
      await route.fulfill({ json: b.provider === 'finnhub' ? STOCKS : COINS })
    })
    await page.route('https://api.coingecko.com/**', route => route.fulfill({ json: COINS, headers: { 'access-control-allow-origin': '*' } }))
    await page.goto('/watchlist')
    const input = page.getByRole('combobox')
    await input.fill('aap')
    await expect(page.getByRole('option')).toHaveCount(3)
    await expect(page.getByRole('option').first()).toContainText('AAPL')
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
    await expect(input).toHaveAttribute('aria-activedescendant', /opt-1/)
    await page.screenshot({ path: `/tmp/claude-0/shots/search-${scheme}-${vp.width}.png` })
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('APLE')
    await page.getByLabel('Crypto', { exact: true }).check()
    await input.fill('btc')
    await expect(page.getByRole('option')).toHaveCount(2)
    await expect(page.getByRole('option').first()).toContainText('Bitcoin')
    await page.screenshot({ path: `/tmp/claude-0/shots/search-crypto-${scheme}-${vp.width}.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
  })
}

test('proxy error and empty states', async ({ page }) => {
  await signedInApp(page)
  let mode = 'err'
  await page.route('**/functions/v1/market-proxy', route =>
    mode === 'err' ? route.fulfill({ status: 400, json: { error: 'That endpoint is not allowed.' } }) : route.fulfill({ json: { count: 0, result: [] } }))
  await page.goto('/watchlist')
  const input = page.getByRole('combobox')
  await input.fill('zzz')
  await expect(page.locator('.wl-combo-note')).toContainText('Suggestions are unavailable')
  await expect(page.getByRole('button', { name: 'Add to watchlist' })).toBeEnabled()
  mode = 'empty'
  await input.fill('qqq')
  await expect(page.locator('.wl-combo-note')).toContainText('No matches for “qqq”')
})
