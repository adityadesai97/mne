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

  test('command bar opens with the keyboard shortcut and toggles closed with it', async ({ page }) => {
    await signedInApp(page)
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await expect(page.getByPlaceholder('Ask anything or issue a command...')).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Ask mne' })).toBeVisible()
    // Focus is inside the panel, so the shortcut closes it again.
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('complementary', { name: 'Ask mne' })).toHaveCount(0)
  })

  test('the header pill opens a docked panel that reflows the page, Esc closes it and returns focus', async ({ page }) => {
    await signedInApp(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const main = page.locator('.mne-with-dock')
    await expect(main).toBeVisible()
    const widthClosed = (await main.boundingBox())!.width

    const pill = page.getByRole('button', { name: 'Ask or search' })
    await expect(pill).toContainText(/⌘K|Ctrl K/)
    // The floating button is gone.
    await expect(page.getByRole('button', { name: 'Open command bar' })).toHaveCount(0)
    await pill.click()

    const panel = page.getByRole('complementary', { name: 'Ask mne' })
    await expect(panel).toBeVisible()
    await expect(page.getByPlaceholder('Ask anything or issue a command...')).toBeFocused()
    await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(widthClosed - 392, -1)
    // Not modal: the page beside it is still there and interactive.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    // The conversation survives navigating while the panel is open.
    await page.getByPlaceholder('Ask anything or issue a command...').fill('create:mock_data')
    await page.keyboard.press('Enter')
    await expect(panel.getByText('Create mock portfolio?')).toBeVisible()
    await page.getByRole('link', { name: 'Watchlist' }).first().click()
    await expect(page).toHaveURL(/\/watchlist/)
    await expect(panel.getByText('Create mock portfolio?')).toBeVisible()

    await page.getByPlaceholder('Reply...').press('Escape')
    await expect(panel).toHaveCount(0)
    await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(widthClosed, -1)
    await expect(pill).toBeFocused()
  })

  test('a pending write is confirmed from a pinned bar, and Cancel only dismisses it', async ({ page }) => {
    await signedInApp(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask or search' }).click()
    await page.getByPlaceholder('Ask anything or issue a command...').fill('create:mock_data')
    await page.keyboard.press('Enter')

    const panel = page.getByRole('complementary', { name: 'Ask mne' })
    const pinned = panel.locator('.cmdk-pin')
    await expect(pinned.getByRole('button', { name: 'Confirm' })).toBeVisible()
    await pinned.getByRole('button', { name: 'Cancel' }).click()
    await expect(panel.getByText('Nothing was changed')).toBeVisible()
    await expect(panel).toBeVisible()
  })

  test('"Ask about this" chips open the bar with a context question', async ({ page }) => {
    await signedInApp(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('body')).toContainText('2,000', { timeout: 15_000 })
    await page.getByRole('button', { name: /Ask about this: Explain my allocation/ }).click()
    await expect(page.getByRole('complementary', { name: 'Ask mne' }).getByText('Explain my allocation')).toBeVisible()
  })

  test('on a phone the raised centre action opens a bottom sheet and Settings sits in the header', async ({ page }) => {
    await signedInApp(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Ask or search' })).toBeHidden()
    // Settings is no longer a tab but stays reachable.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings/)

    await page.getByRole('button', { name: 'Ask mne' }).click()
    const sheet = page.getByRole('dialog', { name: 'Ask mne' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('data-detent', 'half')
    await sheet.getByRole('button', { name: 'Full', exact: true }).click()
    await expect(sheet).toHaveAttribute('data-detent', 'full')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('an uncaught runtime error is reported to client_errors', async ({ page }) => {
    const db = await signedInApp(page)
    await page.goto('/')
    await page.evaluate(() => { setTimeout(() => { throw new Error('e2e boom') }, 0) })
    await expect.poll(() => db.calls.some(c => c.path.endsWith('/client_errors'))).toBe(true)
  })
})
