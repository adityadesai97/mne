import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run the real app in a real browser against a fake Supabase
// (see e2e/fakeSupabase.ts), so they need no database, keys or network.
export const FAKE_SUPABASE_URL = 'https://e2e.supabase.test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4181',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
    // Use the pre-installed Chromium when one is provided (sandboxes, CI images).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 4181 --strictPort',
    url: 'http://localhost:4181',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
    },
  },
})
