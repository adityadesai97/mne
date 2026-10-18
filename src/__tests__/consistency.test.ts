import { computePortfolioDailyChange, computeNetWorthDailyChange, computeTotalNetWorth, computeDailyChange, localDateKey } from '../lib/portfolio'
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

  // Yesterday's snapshot, plus a stale row dated today and a future-dated (UTC) one, both ignored.
  const snapshots = [{ date: '2000-01-01', value: 1 }, { date: '2024-06-14', value: netWorth - 1500 }, { date: today, value: netWorth }, { date: '2999-01-01', value: netWorth }]
  const ctx = { assets, getSnapshotsCached: async () => snapshots } as any
  const summary: any = await executeReadTool('get_portfolio_summary', {}, ctx)
  expect(summary.totals.netWorth).toBe(Math.round(netWorth * 100) / 100)
  expect(summary.today.stockMarketMove).toBe(daily.dollarChange)
  expect(summary.today.stockMarketMovePct).toBeCloseTo(Math.round(daily.percentChange * 100) / 100, 10)
  // The Home card and the command bar read the same net-worth-vs-yesterday figure.
  const vsYesterday = computeNetWorthDailyChange(netWorth, snapshots)!
  expect(vsYesterday.dollarChange).toBe(1500)
  expect(vsYesterday.fromDate).toBe('2024-06-14')
  expect(summary.today.netWorthChange).toBe(vsYesterday.dollarChange)
  expect(summary.today.netWorthChangePct).toBeCloseTo(Math.round(vsYesterday.percentChange * 100) / 100, 10)

  const positions: any = await executeReadTool('get_positions', {}, ctx)
  const rows: any[] = positions.rows ?? positions.positions ?? []
  for (const { asset, change } of daily.positions) {
    const row = rows.find((r) => r.symbol === asset.ticker.symbol)
    expect(row.dayChange).toBe(change.dollarChange)
    expect(computeDailyChange(asset)!.dollarChange).toBe(change.dollarChange)
  }
})

test('net worth daily change is measured from the previous day, any day of the week', () => {
  const snaps = [{ date: '2026-10-16', value: '1288904.86' }, { date: '2026-10-17', value: 1290375.93 }, { date: '2026-10-18', value: 1290395.88 }]
  // Saturday (markets closed): compared to Friday, not Saturday's own row or the UTC-dated Sunday row.
  const sat = computeNetWorthDailyChange(1290395.88, snaps, '2026-10-17')!
  expect(sat.fromDate).toBe('2026-10-16')
  expect(sat.dollarChange).toBeCloseTo(1491.02, 2)
  expect(sat.percentChange).toBeCloseTo(0.1157, 3)
  expect(computeNetWorthDailyChange(100, [{ date: '2026-10-17', value: 100 }], '2026-10-17')).toBeNull()
})
