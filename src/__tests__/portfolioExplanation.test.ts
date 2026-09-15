import {
  computeMovers, computeMoversForWindow, shouldRegenerate, buildStaticNoMoveSummary, buildExplanationUserPrompt, buildTeaser, todayMarketDate, stripSources,
  explanationTriggerQuestion, DAILY_PORTFOLIO_SLOT, MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME, MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME,
  type PortfolioInsightSlot,
} from '../lib/portfolioExplanation'
import type { TickerPricePoint } from '../lib/db/tickerPriceHistory'

// shouldRegenerate takes a full MoversResult — a minimal one for tests that
// only care about the portfolio-level (aggregate %) check.
function moversResult(dayChangePercent: number, overrides: Partial<ReturnType<typeof computeMovers>> = {}) {
  return { movers: [], dayChangeDollars: 0, dayChangePercent, hasMajorMove: true, isBroadMarketMove: false, themeMoves: [], ...overrides }
}

function stockAsset(opts: {
  symbol: string
  name?: string
  currentPrice: number
  previousClose: number
  shares?: number
  themes?: string[]
  tickerId?: string
}) {
  return {
    asset_type: 'Stock',
    name: opts.name ?? opts.symbol,
    price: null,
    ticker: {
      id: opts.tickerId ?? opts.symbol,
      symbol: opts.symbol,
      current_price: opts.currentPrice,
      previous_close: opts.previousClose,
      ticker_themes: (opts.themes ?? []).map(name => ({ theme: { name } })),
    },
    stock_subtypes: [{ transactions: [{ count: String(opts.shares ?? 10), cost_price: '1' }], rsu_grants: [] }],
  } as any
}

// Builds a days-ago date key the same way findPriceApproxNDaysAgo does.
function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

test('a single outsized mover is flagged as a major move with no theme/market signal', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 110, previousClose: 100, shares: 10 }), // +10%, +$100
    stockAsset({ symbol: 'BND', currentPrice: 100.1, previousClose: 100, shares: 10 }), // +0.1%, noise
  ]
  const result = computeMovers(assets, 100_000)
  expect(result.hasMajorMove).toBe(true)
  expect(result.isBroadMarketMove).toBe(false)
  expect(result.themeMoves).toEqual([])
  expect(result.movers[0].symbol).toBe('NVDA')
  expect(result.movers[0].dollarChange).toBe(100)
  expect(result.movers[0].percentChange).toBeCloseTo(10, 5)
})

test('a majority of a theme moving together is flagged as a theme move', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 103, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AMD', currentPrice: 102, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AVGO', currentPrice: 104, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'KO', currentPrice: 100, previousClose: 100, shares: 10 }), // flat, no theme
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(result.themeMoves).toHaveLength(1)
  expect(result.themeMoves[0].theme).toBe('Semiconductors')
  expect(result.themeMoves[0].direction).toBe('up')
  expect(result.themeMoves[0].memberSymbols.sort()).toEqual(['AMD', 'AVGO', 'NVDA'])
  // Movers list is widened to include every theme-cluster member, even
  // though each one's own $ contribution is small.
  const moverSymbols = result.movers.map(m => m.symbol)
  expect(moverSymbols).toEqual(expect.arrayContaining(['NVDA', 'AMD', 'AVGO']))
  expect(result.movers.find(m => m.symbol === 'NVDA')?.theme).toBe('Semiconductors')
})

test('a majority of distinct holdings moving the same direction is a broad market move', () => {
  const assets = [
    stockAsset({ symbol: 'AAA', currentPrice: 102, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'BBB', currentPrice: 101.5, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'CCC', currentPrice: 102.5, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'DDD', currentPrice: 100, previousClose: 100, shares: 10 }), // flat
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(result.isBroadMarketMove).toBe(true)
})

test('no broad market move with too few distinct holdings', () => {
  const assets = [
    stockAsset({ symbol: 'AAA', currentPrice: 110, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'BBB', currentPrice: 110, previousClose: 100, shares: 10 }),
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(result.isBroadMarketMove).toBe(false)
})

test('shouldRegenerate is true with no prior explanation', () => {
  expect(shouldRegenerate(moversResult(1.2), null)).toBe(true)
})

test('shouldRegenerate is false when nothing has changed at any level, same market day', () => {
  const last = { day_change_percent: 1.0, market_date: todayMarketDate(), movers: [], theme_moves: [] } as any
  expect(shouldRegenerate(moversResult(1.2), last)).toBe(false)
})

test('shouldRegenerate is true once the aggregate swing moves past the hysteresis band', () => {
  const last = { day_change_percent: 1.0, market_date: todayMarketDate(), movers: [], theme_moves: [] } as any
  expect(shouldRegenerate(moversResult(2.0), last)).toBe(true)
})

test('shouldRegenerate is true on a sign flip', () => {
  const last = { day_change_percent: 0.5, market_date: todayMarketDate(), movers: [], theme_moves: [] } as any
  expect(shouldRegenerate(moversResult(-0.5), last)).toBe(true)
})

test('shouldRegenerate is true once a new market day has started, even with an unchanged swing', () => {
  const last = { day_change_percent: 1.2, market_date: '2020-01-01', movers: [], theme_moves: [] } as any
  expect(shouldRegenerate(moversResult(1.2), last)).toBe(true)
})

test('shouldRegenerate is true when a new stock-level mover joins, even with the aggregate swing unchanged', () => {
  const last = { day_change_percent: 1.0, market_date: todayMarketDate(), movers: [], theme_moves: [] } as any
  const current = moversResult(1.0, { movers: [{ symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 8, contributionPct: 100, headlines: [] }] })
  expect(shouldRegenerate(current, last)).toBe(true)
})

test('shouldRegenerate is false when the same significant movers/themes are still the ones driving it', () => {
  const movers = [{ symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 8, contributionPct: 100, headlines: [] }]
  const themeMoves = [{ theme: 'Semiconductors', direction: 'up' as const, avgPercentChange: 6, memberSymbols: ['NVDA', 'AMD', 'AVGO'] }]
  const last = { day_change_percent: 1.0, market_date: todayMarketDate(), movers, theme_moves: themeMoves } as any
  const current = moversResult(1.0, { movers, themeMoves })
  expect(shouldRegenerate(current, last)).toBe(false)
})

test('shouldRegenerate is true when a new sector joins the story, even with the aggregate swing unchanged', () => {
  const last = { day_change_percent: 1.0, market_date: todayMarketDate(), movers: [], theme_moves: [] } as any
  const current = moversResult(1.0, {
    themeMoves: [{ theme: 'Semiconductors', direction: 'up' as const, avgPercentChange: 5, memberSymbols: ['NVDA', 'AMD', 'AVGO'] }],
  })
  expect(shouldRegenerate(current, last)).toBe(true)
})

test('buildStaticNoMoveSummary reports a flat day with no dollar figure', () => {
  expect(buildStaticNoMoveSummary(0, 0)).toBe('No major moves today — your portfolio held steady.')
})

test('buildStaticNoMoveSummary includes the (sub-threshold) swing when nonzero', () => {
  const summary = buildStaticNoMoveSummary(120, 0.2)
  expect(summary).toContain('+$120')
  expect(summary).toContain('+0.20%')
})

test('buildExplanationUserPrompt includes movers and omits empty sections', () => {
  const movers = [{ symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 10, contributionPct: 100, headlines: [] }]
  const prompt = buildExplanationUserPrompt(movers as any, 100, 0.5, [], [])
  expect(prompt).toContain('NVDA (Nvidia)')
  expect(prompt).not.toContain('Theme moves:')
  expect(prompt).not.toContain('Market context:')
})

test('buildExplanationUserPrompt includes theme and market sections when present', () => {
  const movers = [{ symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 10, contributionPct: 100, headlines: [{ title: 'Nvidia beats', source: 'Reuters', url: '', datetime: 0 }] }]
  const themeMoves = [{ theme: 'Semiconductors', direction: 'up' as const, avgPercentChange: 3, memberSymbols: ['NVDA', 'AMD'] }]
  const marketHeadlines = [{ title: 'Fed holds rates', source: 'AP', url: '', datetime: 0 }]
  const prompt = buildExplanationUserPrompt(movers as any, 100, 0.5, themeMoves, marketHeadlines)
  expect(prompt).toContain('"Nvidia beats" (Reuters)')
  expect(prompt).toContain('Theme moves:')
  expect(prompt).toContain('Semiconductors')
  expect(prompt).toContain('Market context:')
  expect(prompt).toContain('Fed holds rates')
})

test('buildExplanationUserPrompt prepends the previous update when carrying it forward', () => {
  const movers = [{ symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 10, contributionPct: 100, headlines: [] }]
  const prompt = buildExplanationUserPrompt(movers as any, 100, 0.5, [], [], 'Earlier today NVDA rallied on strong earnings.')
  expect(prompt).toContain('Earlier update from today: "Earlier today NVDA rallied on strong earnings."')
  expect(prompt.indexOf('Earlier update')).toBeLessThan(prompt.indexOf('Portfolio day change'))
})

test('buildTeaser returns null when there is no major move', () => {
  const result = computeMovers([stockAsset({ symbol: 'KO', currentPrice: 100.05, previousClose: 100, shares: 10 })], 1_000_000)
  expect(buildTeaser(result)).toBeNull()
})

test('buildTeaser names a single dominant mover directly', () => {
  const assets = [
    stockAsset({ symbol: 'CRM', currentPrice: 108, previousClose: 100, shares: 100 }), // +8%, +$800
    stockAsset({ symbol: 'KO', currentPrice: 100.05, previousClose: 100, shares: 10 }), // noise
  ]
  const result = computeMovers(assets, 100_000)
  expect(buildTeaser(result)).toBe('CRM moved +8.00% today. Want to know why?')
})

test('buildTeaser names a flagged sector on the first check of the day, before falling back to a plain count', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 104, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AMD', currentPrice: 103, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AVGO', currentPrice: 106, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(buildTeaser(result)).toBe('Your Semiconductors holdings moved up 4.33% today. Want to know why?')
})

test('buildTeaser counts multiple significant movers when no single one dominates', () => {
  const assets = [
    stockAsset({ symbol: 'AAA', currentPrice: 106, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'BBB', currentPrice: 94, previousClose: 100, shares: 10 }),
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(buildTeaser(result)).toBe('2 items in your portfolio moved substantially today. Want to know why?')
})

test('buildTeaser falls back to the aggregate swing when no single holding crosses the per-stock bar', () => {
  const assets = Array.from({ length: 20 }, (_, i) =>
    stockAsset({ symbol: `T${i}`, currentPrice: 102, previousClose: 100, shares: 1000 }),
  )
  const result = computeMovers(assets, 100_000)
  expect(result.movers.every(m => Math.abs(m.percentChange) < 5)).toBe(true)
  expect(buildTeaser(result)).toMatch(/^Your portfolio went up \d+\.\d\d% today\. Want to know why\?$/)
})

test('buildTeaser calls out a newly-flagged sector when a same-day previous explanation exists', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 106, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AMD', currentPrice: 105, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AVGO', currentPrice: 107, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
  ]
  const result = computeMovers(assets, 1_000_000)
  const previous = { market_date: todayMarketDate(), day_change_percent: result.dayChangePercent, movers: [], theme_moves: [] } as any
  expect(buildTeaser(result, previous)).toBe('New activity in Semiconductors since your last check. Want an updated explanation?')
})

test('buildTeaser calls out a newly-significant mover when no new sector is involved', () => {
  const assets = [stockAsset({ symbol: 'CRM', currentPrice: 108, previousClose: 100, shares: 100 })]
  const result = computeMovers(assets, 100_000)
  const previous = { market_date: todayMarketDate(), day_change_percent: 0, movers: [], theme_moves: [] } as any
  expect(buildTeaser(result, previous)).toBe('CRM just moved. Want an updated explanation?')
})

test('buildTeaser falls back to a generic "changed" line when only the aggregate swing moved', () => {
  const assets = Array.from({ length: 20 }, (_, i) => stockAsset({ symbol: `T${i}`, currentPrice: 102, previousClose: 100, shares: 1000 }))
  const result = computeMovers(assets, 100_000)
  const previous = { market_date: todayMarketDate(), day_change_percent: 0, movers: [], theme_moves: [] } as any
  expect(buildTeaser(result, previous)).toBe("Your portfolio's move has changed since your last check. Want an updated explanation?")
})

test('buildTeaser uses the plain generic framing when nothing has changed since the previous explanation', () => {
  const assets = [stockAsset({ symbol: 'CRM', currentPrice: 108, previousClose: 100, shares: 100 })]
  const result = computeMovers(assets, 100_000)
  const previous = {
    market_date: todayMarketDate(),
    day_change_percent: result.dayChangePercent,
    movers: result.movers,
    theme_moves: result.themeMoves,
  } as any
  expect(buildTeaser(result, previous)).toBe('CRM moved +8.00% today. Want to know why?')
})

test('buildTeaser ignores a previous explanation from an earlier market day', () => {
  const assets = [stockAsset({ symbol: 'CRM', currentPrice: 108, previousClose: 100, shares: 100 })]
  const result = computeMovers(assets, 100_000)
  const previous = { market_date: '2020-01-01', day_change_percent: 0, movers: [], theme_moves: [] } as any
  expect(buildTeaser(result, previous)).toBe('CRM moved +8.00% today. Want to know why?')
})

test('stripSources removes a legacy appended Sources block, if present', () => {
  const legacy = 'Portfolio rose today.\n\nSources:\n- [Nvidia beats](https://example.com) — Reuters'
  expect(stripSources(legacy)).toBe('Portfolio rose today.')
})

test('stripSources leaves a summary with no Sources block unchanged', () => {
  expect(stripSources('Portfolio rose today.')).toBe('Portfolio rose today.')
})

test('computeMoversForWindow sources moves from ticker_price_history instead of previous_close', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 130, previousClose: 129, shares: 10, tickerId: 't-nvda' }), // flat today, +30% over the window
  ]
  const priceHistory = new Map<string, TickerPricePoint[]>([
    ['t-nvda', [{ date: daysAgo(10), price: 100 }, { date: daysAgo(1), price: 129 }]],
  ])
  const result = computeMoversForWindow(assets, 100_000, priceHistory, 7, 'weekly')
  expect(result.movers).toHaveLength(1)
  expect(result.movers[0].percentChange).toBeCloseTo(30, 0)
  expect(result.movers[0].dollarChange).toBeCloseTo(300, 0)
})

test('computeMoversForWindow excludes a ticker with no history old enough for the window', () => {
  const assets = [
    stockAsset({ symbol: 'NEW', currentPrice: 110, previousClose: 109, shares: 10, tickerId: 't-new' }),
  ]
  // Only 2 days of history recorded — not enough for a 30-day (monthly) window.
  const priceHistory = new Map<string, TickerPricePoint[]>([
    ['t-new', [{ date: daysAgo(2), price: 108 }]],
  ])
  const result = computeMoversForWindow(assets, 100_000, priceHistory, 30, 'monthly')
  expect(result.movers).toHaveLength(0)
  expect(result.hasMajorMove).toBe(false)
})

test('move-size bars scale with timeframe — a move major daily is not automatically major weekly', () => {
  expect(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.daily).toBeLessThan(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.weekly)
  expect(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.weekly).toBeLessThan(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.monthly)
  expect(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.monthly).toBeLessThan(MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.yearly)

  const assets = [stockAsset({ symbol: 'NVDA', currentPrice: 106, previousClose: 105, shares: 10, tickerId: 't-nvda' })] // +6% over the window
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-nvda', [{ date: daysAgo(7), price: 100 }]]])
  const weekly = computeMoversForWindow(assets, 100_000, priceHistory, 7, 'weekly')
  expect(weekly.hasMajorMove).toBe(false) // 6% < the 8% weekly bar

  const dailyLikeAssets = [stockAsset({ symbol: 'NVDA', currentPrice: 106, previousClose: 100, shares: 10 })] // +6% today
  expect(computeMovers(dailyLikeAssets, 100_000).hasMajorMove).toBe(true) // 6% >= the 5% daily bar
})

test('shouldRegenerate with resetsDaily false ignores a stale market_date on a rolling window', () => {
  const current = moversResult(2)
  const stale = { market_date: '2020-01-01', day_change_percent: 2, movers: [], theme_moves: [] } as any
  expect(shouldRegenerate(current, stale)).toBe(true) // default resetsDaily=true still resets
  expect(shouldRegenerate(current, stale, false)).toBe(false) // same swing, no membership change — no reset for a rolling window
})

test('explanationTriggerQuestion matches the exact legacy string for the daily portfolio slot', () => {
  expect(explanationTriggerQuestion(DAILY_PORTFOLIO_SLOT)).toBe('Why is my portfolio moving?')
})

test('explanationTriggerQuestion names the stock/sector and timeframe for other slots', () => {
  const stockSlot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'NVDA', timeframe: 'weekly', windowDays: 7 }
  expect(explanationTriggerQuestion(stockSlot)).toBe('Why did NVDA move this week?')

  const sectorSlot: PortfolioInsightSlot = { scope: 'sector', scopeKey: 'Semiconductors', timeframe: 'monthly', windowDays: 30 }
  expect(explanationTriggerQuestion(sectorSlot)).toBe('Why did my Semiconductors holdings move this month?')

  const customSlot: PortfolioInsightSlot = { scope: 'portfolio', scopeKey: '', timeframe: 'custom', windowDays: 60 }
  expect(explanationTriggerQuestion(customSlot)).toBe('Why is my portfolio moving over the last 60 days?')
})

test('MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME also scales up with timeframe', () => {
  expect(MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME.daily).toBeLessThan(MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME.yearly)
})
