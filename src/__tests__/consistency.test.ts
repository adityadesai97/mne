import { computePortfolioDailyChange, computeTotalNetWorth, computeDailyChange, localDateKey } from '../lib/portfolio'
import { computeMovers } from '../lib/portfolioExplanation'
import { executeReadTool } from '../lib/claude'

// Every surface that reports a total or "today's change" must read the same
// ground truth (src/lib/portfolio.ts). This fixture has a lot bought today, an
// RSU lot with shares sold at vest, a flat-balance asset and a Bond.
const today = localDateKey()
const stock = (id: string, symbol: string, price: number, prev: number, lots: any[]) => ({
  id, name: symbol, asset_type: 'Stock', price: null, location: { name: 'Broker', account_type: 'Investment' },
  ticker: { id: `t-${symbol}`, symbol, current_price: price, previous_close: prev, ticker_themes: [] },
  stock_subtypes: [{ subtype: 'Market', transactions: lots, rsu_grants: [] }],
}) as any

const assets = [
  stock('a1', 'CRM', 96, 100, [{ count: 100, cost_price: 80, purchase_date: '2024-01-01' }]),
  stock('a2', 'NVDA', 110, 100, [
    { count: 10, cost_price: 90, purchase_date: '2024-01-01' },
    { count: 5, cost_price: 108, purchase_date: today },
    { count: 20, cost_price: 50, purchase_date: '2024-02-01', sold_at_vest: 8 },
  ]),
  { id: 'c1', name: 'Checking', asset_type: 'Cash', price: 5000, ticker: null, stock_subtypes: [], location: { name: 'Bank', account_type: 'Bank' } } as any,
]

test('Home, Pulse and the command bar agree on net worth and today\'s change', async () => {
  const netWorth = computeTotalNetWorth(assets)
  const daily = computePortfolioDailyChange(assets, netWorth)
  // CRM: 100 × −4; NVDA: (10 + 12 held) × +10 on prior-close lots, 5 × +2 for today's lot.
  expect(daily.dollarChange).toBe(-400 + 12 * 10 + 10 * 10 + 5 * 2)

  const pulse = computeMovers(assets, netWorth)
  expect(pulse.dayChangeDollars).toBe(daily.dollarChange)
  expect(pulse.dayChangePercent).toBeCloseTo(daily.percentChange, 10)

  const ctx = { assets, getSnapshotsCached: async () => [] } as any
  const summary: any = await executeReadTool('get_portfolio_summary', {}, ctx)
  expect(summary.totals.netWorth).toBe(Math.round(netWorth * 100) / 100)
  expect(summary.today.change).toBe(daily.dollarChange)
  expect(summary.today.changePct).toBeCloseTo(Math.round(daily.percentChange * 100) / 100, 10)

  const positions: any = await executeReadTool('get_positions', {}, ctx)
  const rows: any[] = positions.rows ?? positions.positions ?? []
  for (const { asset, change } of daily.positions) {
    const row = rows.find((r) => r.symbol === asset.ticker.symbol)
    expect(row.dayChange).toBe(change.dollarChange)
    expect(computeDailyChange(asset)!.dollarChange).toBe(change.dollarChange)
  }
})
