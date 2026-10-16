import { expect, test } from '@playwright/test'
import { signedInApp } from './fakeSupabase'

test.describe('signed out', () => {
  test('without a Supabase session the app shows onboarding, not the dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.locator('body')).toContainText(/api key|sign in|get started|welcome/i)
  })
})

test.describe('signed in', () => {
  test('home renders the net worth for the seeded holdings', async ({ page }) => {
    await signedInApp(page)
    await page.goto('/')
    // 10 shares x $200
    await expect(page.locator('body')).toContainText('2,000', { timeout: 15_000 })
  })

  test('every main page loads without the error screen', async ({ page }) => {
    await signedInApp(page)
    for (const path of ['/', '/portfolio', '/charts', '/watchlist', '/settings']) {
      await page.goto(path)
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      await expect(page.locator('main, #root').first()).toBeVisible()
    }
  })

  test('portfolio lists the holding and opens its detail page', async ({ page }) => {
    await signedInApp(page)
    await page.goto('/portfolio')
    await page.getByText('Apple').first().click()
    await expect(page).toHaveURL(/\/portfolio\/asset-1/)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
  })

  test('settings saves a Claude key through the server function, never a table', async ({ page }) => {
    const db = await signedInApp(page)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByText('Update API keys').click()
    await page.getByPlaceholder(/Saved. Enter a new key/).first().fill('sk-ant-e2e-test')
    await page.getByRole('button', { name: 'Save', exact: true }).first().click()
    await expect.poll(() => db.calls.some(c => c.path.endsWith('/rpc/save_llm_key'))).toBe(true)
    expect(db.calls.some(c => c.path.includes('llm_credential_secrets'))).toBe(false)
  })

  test('command bar opens with the keyboard shortcut', async ({ page }) => {
    await signedInApp(page)
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('Ask anything or issue a command...')).toBeVisible()
  })

  test('an uncaught runtime error is reported to client_errors', async ({ page }) => {
    const db = await signedInApp(page)
    await page.goto('/')
    await page.evaluate(() => { setTimeout(() => { throw new Error('e2e boom') }, 0) })
    await expect.poll(() => db.calls.some(c => c.path.endsWith('/client_errors'))).toBe(true)
  })
})
