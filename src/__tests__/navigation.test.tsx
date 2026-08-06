// Diagnostic test: click through every nav tab (client-side routing, no full
// reload) and assert nothing throws. Written to reproduce a reported
// "blank page after navigating" bug in production.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import AppLayout from '../layouts/AppLayout'
import Home from '../pages/Home'
import Portfolio from '../pages/Portfolio'
import AssetDetail from '../pages/AssetDetail'
import Charts from '../pages/Charts'
import Watchlist from '../pages/Watchlist'
import Settings from '../pages/Settings'

const sampleAssets = [
  {
    id: 'a1',
    name: 'Apple',
    asset_type: 'Stock',
    price: null,
    ownership: 'Individual',
    notes: null,
    location: { id: 'l1', name: 'Fidelity' },
    location_id: 'l1',
    ticker_id: 't1',
    ticker: { id: 't1', symbol: 'AAPL', current_price: 200, logo: null, ticker_themes: [] },
    stock_subtypes: [
      {
        id: 'st1',
        subtype: 'Market',
        transactions: [{ id: 'tx1', count: 10, cost_price: 150, purchase_date: '2024-01-01', capital_gains_status: 'Long Term', sold_at_vest: 0 }],
        rsu_grants: [],
      },
    ],
  },
  {
    id: 'a2',
    name: 'Checking',
    asset_type: 'Cash',
    price: 5000,
    ownership: 'Individual',
    notes: null,
    location: { id: 'l2', name: 'Chase' },
    location_id: 'l2',
    ticker_id: null,
    ticker: null,
    stock_subtypes: [],
  },
]

vi.mock('../lib/supabase', () => ({
  isSupabaseReady: () => true,
  onAuthFailure: () => () => {},
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'test@example.com', user_metadata: { full_name: 'Test User' } } }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        order: () => Promise.resolve({ data: [], error: null }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}))

vi.mock('../lib/db/assets', () => ({
  getAllAssets: () => Promise.resolve(sampleAssets),
  getAssetById: (id: string) => Promise.resolve(sampleAssets.find(a => a.id === id) ?? null),
  upsertAsset: () => Promise.resolve({}),
  deleteAsset: () => Promise.resolve(),
}))

vi.mock('../lib/db/snapshots', () => ({
  getSnapshots: () => Promise.resolve([{ date: '2024-01-01', value: 1000 }, { date: '2024-06-01', value: 2000 }]),
  recordDailySnapshot: () => Promise.resolve(),
  backfillHistoricalSnapshots: () => Promise.resolve(),
}))

vi.mock('../lib/db/transactions', () => ({
  promoteStaleShortTermLots: () => Promise.resolve(0),
  deleteTransaction: () => Promise.resolve(),
  deleteTransactions: () => Promise.resolve(),
  updateTransaction: () => Promise.resolve(),
}))

vi.mock('../lib/db/settings', () => ({
  syncFinnhubKey: () => Promise.resolve(),
  getSettings: () => Promise.resolve(null),
  saveSettings: () => Promise.resolve(),
}))

vi.mock('../lib/db/tickers', () => ({
  getAllTickers: () => Promise.resolve([{ id: 't1', symbol: 'AAPL', current_price: 200, logo: null, ticker_themes: [] }]),
  refreshAllPrices: () => Promise.resolve(),
  upsertTicker: () => Promise.resolve({}),
  deleteTicker: () => Promise.resolve(),
}))

vi.mock('../lib/db/themes', () => ({
  getAllThemes: () => Promise.resolve([]),
  getOrCreateTheme: () => Promise.resolve('theme1'),
  addTickerTheme: () => Promise.resolve(),
  removeTickerTheme: () => Promise.resolve(),
}))

vi.mock('../lib/db/grants', () => ({
  endGrant: () => Promise.resolve(),
  deleteGrant: () => Promise.resolve(),
}))

vi.mock('../lib/pushNotifications', () => ({
  subscribeToPush: () => Promise.resolve(),
  unsubscribeFromPush: () => Promise.resolve(),
  getPushEnabled: () => Promise.resolve(false),
}))

vi.mock('../lib/theme', () => ({
  applyTheme: () => {},
  initTheme: () => {},
}))

vi.mock('../lib/autoThemes', () => ({
  autoAssignThemesForTicker: () => Promise.resolve({ assignedCount: 0 }),
  autoAssignThemesForTickerIfEnabled: () => Promise.resolve({ assignedCount: 0 }),
}))

function buildRouter(initialPath = '/') {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'portfolio', element: <Portfolio /> },
          { path: 'portfolio/:id', element: <AssetDetail /> },
          { path: 'charts', element: <Charts /> },
          { path: 'watchlist', element: <Watchlist /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  )
}

test('clicking through every nav tab does not crash the app', async () => {
  const errors: unknown[] = []
  const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => errors.push(e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  const user = userEvent.setup()
  const router = buildRouter('/')
  render(<RouterProvider router={router} />)

  // Home should render first (sidebar/bottom-nav labels appear once loaded).
  await waitFor(() => expect(screen.queryAllByText('Portfolio').length).toBeGreaterThan(0))

  const tabOrder = ['Portfolio', 'Charts', 'Watchlist', 'Settings', 'Home']
  for (const label of tabOrder) {
    const links = screen.getAllByText(label)
    await user.click(links[0])
    // Give framer-motion transitions + effects a moment to settle, and make
    // sure the app didn't unmount to a blank document (React's default
    // behavior for an uncaught render error with no error boundary).
    await waitFor(() => {
      expect(document.body.innerHTML.length).toBeGreaterThan(0)
      expect(screen.queryAllByText('Home').length).toBeGreaterThan(0)
    })
  }

  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)

  if (errors.length > 0) {
    throw new Error(`Uncaught error(s) during navigation: ${errors.map(String).join(' | ')}`)
  }
})
