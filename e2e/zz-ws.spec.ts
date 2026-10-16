import { test } from '@playwright/test'
import { signedInApp } from './fakeSupabase'
for (const theme of ['dark', 'light']) for (const [w, h] of [[1200, 900], [390, 800]]) {
  test(`shots ${theme} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.addInitScript(t => localStorage.setItem('mne_theme', t), theme)
    await signedInApp(page, {
      tickers: [{ id: 'tick-1', symbol: 'AAPL', current_price: 228.14, previous_close: 227.2, kind: 'stock', ticker_themes: [{ theme: { id: 'th1', name: 'Mega cap' } }] }, { id: 't2', symbol: 'AMD', current_price: 164.88, previous_close: 167.9, kind: 'stock', ticker_themes: [] }],
      themes: [{ id: 'th1', name: 'Mega cap', theme_targets: [{ target_percentage: 50, is_active: true }] }],
    })
    await page.goto('/watchlist'); await page.getByRole('heading',{name:'Watchlist'}).waitFor({timeout:20000}); await page.waitForTimeout(500)
    await page.screenshot({ path: `/tmp/claude-0/shots/ws-watch-${theme}-${w}.png`, fullPage: true })
    await page.goto('/settings'); await page.getByRole('heading',{name:'Settings'}).waitFor({timeout:20000})
    await page.getByText('Update API keys').click()
    await page.screenshot({ path: `/tmp/claude-0/shots/ws-set-${theme}-${w}.png`, fullPage: true })
  })
}
