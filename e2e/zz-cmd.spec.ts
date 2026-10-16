import { test } from '@playwright/test'
import { signedInApp } from './fakeSupabase'
for (const theme of ['dark', 'light']) for (const [w, h] of [[1200, 800], [390, 800]]) {
  test(`cmd ${theme} ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.addInitScript((t) => localStorage.setItem('mne_theme', t), theme)
    await signedInApp(page)
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Ask anything or issue a command...').fill('create:mock_data')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `/tmp/claude-0/shots/cmd-c-${theme}-${w}.png` })
  })
}
