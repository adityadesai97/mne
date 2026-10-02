import {
  trimToLastSentence,
  computeMovers, computeMoversForWindow, shouldRegenerate, buildStaticNoMoveSummary, buildExplanationUserPrompt, buildTeaser, todayMarketDate, stripSources,
  explanationTriggerQuestion, DAILY_PORTFOLIO_SLOT, MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME, MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME,
  computeCandidateSlots, buildSlotTeaser, scopeMoversResult, CUSTOM_WINDOW_DAYS,
  type PortfolioInsightSlot,
} from '../lib/portfolioExplanation'
import type { TickerPricePoint } from '../lib/db/tickerPriceHistory'
import { localDateKey } from '../lib/portfolio'

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

test('buildTeaser leads with the portfolio and names the flagged sector as context', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 104, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AMD', currentPrice: 103, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AVGO', currentPrice: 106, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
  ]
  const result = computeMovers(assets, 1_000_000)
  expect(buildTeaser(result)).toMatch(/^Your portfolio went up [\d.]+% today, with Semiconductors moving the most\. Want to know why\?$/)
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

test('scopeMoversResult narrows to just one stock for a stock-scope slot', () => {
  const movers = [
    { symbol: 'NVDA', name: 'Nvidia', dollarChange: 100, percentChange: 8, contributionPct: 60, headlines: [] },
    { symbol: 'AMD', name: 'AMD', dollarChange: 50, percentChange: 4, contributionPct: 40, headlines: [] },
  ]
  const result = moversResult(1.0, { movers, themeMoves: [] })
  const slot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'NVDA', timeframe: 'daily', windowDays: 1 }
  const scoped = scopeMoversResult(result, slot)
  expect(scoped.movers).toEqual([movers[0]])
  expect(scoped.hasMajorMove).toBe(true)
  expect(scoped.dayChangeDollars).toBe(100)
  expect(scoped.dayChangePercent).toBe(8)
})

test('buildSlotTeaser for DAILY_PORTFOLIO_SLOT matches buildTeaser exactly', () => {
  const assets = [stockAsset({ symbol: 'CRM', currentPrice: 108, previousClose: 100, shares: 100 })]
  const result = computeMovers(assets, 100_000)
  expect(buildSlotTeaser(DAILY_PORTFOLIO_SLOT, result)).toBe(buildTeaser(result))
})

test('buildSlotTeaser names the stock directly for a stock-scope slot', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 110, previousClose: 100, shares: 10 }),
    stockAsset({ symbol: 'KO', currentPrice: 100.05, previousClose: 100, shares: 10 }),
  ]
  const result = computeMovers(assets, 100_000)
  const slot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'NVDA', timeframe: 'daily', windowDays: 1 }
  expect(buildSlotTeaser(slot, result)).toBe('NVDA moved +10.00% today. Want to know why?')
})

test('buildSlotTeaser names the sector for a sector-scope slot', () => {
  const assets = [
    stockAsset({ symbol: 'NVDA', currentPrice: 106, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AMD', currentPrice: 105, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
    stockAsset({ symbol: 'AVGO', currentPrice: 107, previousClose: 100, shares: 10, themes: ['Semiconductors'] }),
  ]
  const result = computeMovers(assets, 1_000_000)
  const slot: PortfolioInsightSlot = { scope: 'sector', scopeKey: 'Semiconductors', timeframe: 'daily', windowDays: 1 }
  expect(buildSlotTeaser(slot, result)).toBe('Your Semiconductors holdings moved up 6.00% today. Want to know why?')
})

test('buildSlotTeaser returns null for a stock-scope slot whose mover no longer qualifies', () => {
  const assets = [stockAsset({ symbol: 'KO', currentPrice: 100.05, previousClose: 100, shares: 10 })]
  const result = computeMovers(assets, 100_000)
  const slot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'NVDA', timeframe: 'daily', windowDays: 1 }
  expect(buildSlotTeaser(slot, result)).toBeNull()
})

test('computeCandidateSlots collapses a stock crossing its bar at several timeframes into one slot (the shortest)', () => {
  const assets = [stockAsset({ symbol: 'NVDA', currentPrice: 110, previousClose: 100, shares: 10, tickerId: 't-nvda' })]
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-nvda', [{ date: daysAgo(7), price: 95 }]]])
  const slots = computeCandidateSlots(assets, 1_000_000, priceHistory)
  expect(slots).toContainEqual({ scope: 'stock', scopeKey: 'NVDA', timeframe: 'daily', windowDays: 1 })
  expect(slots.filter(s => s.scope === 'stock' && s.scopeKey === 'NVDA')).toHaveLength(1)
})

test('computeCandidateSlots finds a notable custom-window move not covered by any fixed timeframe', () => {
  const assets = [stockAsset({ symbol: 'NVDA', currentPrice: 130, previousClose: 129, shares: 10, tickerId: 't-nvda' })]
  const priceHistory = new Map<string, TickerPricePoint[]>([
    ['t-nvda', [
      { date: daysAgo(60), price: 100 }, // +30% over 60 days
      { date: daysAgo(30), price: 115 }, // +13% over 30 days — under the 15% monthly bar
      { date: daysAgo(7), price: 122 }, // +6.6% over 7 days — under the 8% weekly bar
    ]],
  ])
  const slots = computeCandidateSlots(assets, 1_000_000, priceHistory)
  const fixedTimeframeSlots = slots.filter(s => s.scopeKey === 'NVDA' && s.timeframe !== 'custom')
  expect(fixedTimeframeSlots).toHaveLength(0)
  const customSlot = slots.find(s => s.scope === 'stock' && s.scopeKey === 'NVDA' && s.timeframe === 'custom')
  expect(customSlot).toBeDefined()
  expect(CUSTOM_WINDOW_DAYS).toContain(customSlot!.windowDays)
})

test('trimToLastSentence drops a dangling fragment only when the reply hit its token cap', () => {
  expect(trimToLastSentence('First sentence. Second sentence. Third cut of', 'length')).toBe('First sentence. Second sentence.')
  expect(trimToLastSentence('Complete reply without a period', 'stop')).toBe('Complete reply without a period')
})

test('crypto is held to a higher major-move bar than stocks', () => {
  const crypto = (symbol: string, currentPrice: number) => ({ ...stockAsset({ symbol, currentPrice, previousClose: 100, shares: 1 }), asset_type: 'Crypto' })
  // +7%: past the 5% stock bar, under the crypto bar (2x = 10%).
  const stockOnly = [stockAsset({ symbol: 'NVDA', currentPrice: 107, previousClose: 100, shares: 1 })]
  const cryptoOnly = [crypto('BTC', 107)]
  const stockSlots = computeCandidateSlots(stockOnly, 1_000_000, new Map())
  const cryptoSlots = computeCandidateSlots(cryptoOnly, 1_000_000, new Map())
  expect(stockSlots.some(s => s.scope === 'stock' && s.scopeKey === 'NVDA')).toBe(true)
  expect(cryptoSlots.some(s => s.scope === 'stock' && s.scopeKey === 'BTC')).toBe(false)
  expect(computeMovers(cryptoOnly, 1_000_000).hasMajorMove).toBe(false)

  // +12%: over the crypto bar too.
  const bigCrypto = [crypto('BTC', 112)]
  expect(computeMovers(bigCrypto, 1_000_000).hasMajorMove).toBe(true)
  expect(computeMovers(bigCrypto, 1_000_000).movers[0].crypto).toBe(true)
  expect(computeCandidateSlots(bigCrypto, 1_000_000, new Map()).some(s => s.scope === 'stock' && s.scopeKey === 'BTC')).toBe(true)
})

// ── Window moves measure what the user held, not the asset ───────────────

function lotAsset(opts: {
  symbol: string
  currentPrice: number
  lots: { units: number; cost: number; boughtDaysAgo?: number }[]
  assetType?: 'Stock' | 'Crypto'
}) {
  return {
    asset_type: opts.assetType ?? 'Stock',
    name: opts.symbol,
    price: null,
    ticker: { id: `t-${opts.symbol}`, symbol: opts.symbol, current_price: opts.currentPrice, previous_close: opts.currentPrice, ticker_themes: [] },
    stock_subtypes: [{
      transactions: opts.lots.map(l => ({
        count: String(l.units),
        cost_price: String(l.cost),
        ...(l.boughtDaysAgo != null ? { purchase_date: daysAgo(l.boughtDaysAgo) } : {}),
      })),
      rsu_grants: [],
    }],
  } as any
}

test('a position bought during the window is measured from what was paid, not from the asset\'s move before purchase (the reported QNT case)', () => {
  // The coin is up ~158% over the week (88 -> 227.94), but both lots were
  // bought mid-week: 5.9784 @ 164.882 five days ago, 15.7033 @ 253.253 three
  // days ago. Held positions are roughly flat since purchase.
  const qnt = lotAsset({
    symbol: 'QNT', assetType: 'Crypto', currentPrice: 227.94,
    lots: [{ units: 5.9784, cost: 164.882, boughtDaysAgo: 5 }, { units: 15.7033, cost: 253.253, boughtDaysAgo: 3 }],
  })
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-QNT', [{ date: daysAgo(8), price: 88.3 }, { date: daysAgo(2), price: 240 }]]])
  const result = computeMoversForWindow([qnt], 100_000, priceHistory, 7, 'weekly')

  const startValue = 5.9784 * 164.882 + 15.7033 * 253.253
  const gain = 21.6817 * 227.94 - startValue
  expect(result.movers).toHaveLength(1)
  expect(result.movers[0].dollarChange).toBeCloseTo(gain, 1)
  expect(result.movers[0].percentChange).toBeCloseTo((gain / startValue) * 100, 1) // movers round to 0.01%
  expect(Math.abs(result.movers[0].percentChange)).toBeLessThan(1) // not +158%
  expect(result.movers[0].sinceBuy).toBe(true)
  expect(result.hasMajorMove).toBe(false)
  // ...and so the carousel doesn't surface a QNT card at any timeframe.
  const slots = computeCandidateSlots([qnt], 100_000, priceHistory)
  expect(slots.filter(s => s.scopeKey === 'QNT')).toEqual([])
})

test('a lot held since before the window anchors at the window-start price; a lot bought inside it anchors at cost', () => {
  const asset = lotAsset({
    symbol: 'MIX', currentPrice: 200,
    lots: [{ units: 10, cost: 50, boughtDaysAgo: 30 }, { units: 10, cost: 150, boughtDaysAgo: 2 }],
  })
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-MIX', [{ date: daysAgo(10), price: 100 }]]])
  const [mover] = computeMoversForWindow([asset], 100_000, priceHistory, 7, 'weekly').movers
  // old lot: 10 x (200-100) = 1000; new lot: 10 x (200-150) = 500; start value 1000 + 1500
  expect(mover.dollarChange).toBeCloseTo(1500, 5)
  expect(mover.percentChange).toBeCloseTo((1500 / 2500) * 100, 5)
  expect(mover.sinceBuy).toBeUndefined()
})

test('a position bought entirely inside the window needs no price history; one with an older lot still does', () => {
  const brandNew = lotAsset({ symbol: 'NEW', currentPrice: 130, lots: [{ units: 10, cost: 100, boughtDaysAgo: 2 }] })
  const noHistory = new Map<string, TickerPricePoint[]>()
  const included = computeMoversForWindow([brandNew], 100_000, noHistory, 7, 'weekly')
  expect(included.movers).toHaveLength(1)
  expect(included.movers[0].percentChange).toBeCloseTo(30, 5)

  const hasOldLot = lotAsset({ symbol: 'OLD', currentPrice: 130, lots: [{ units: 10, cost: 100, boughtDaysAgo: 2 }, { units: 5, cost: 90, boughtDaysAgo: 40 }] })
  expect(computeMoversForWindow([hasOldLot], 100_000, noHistory, 7, 'weekly').movers).toHaveLength(0)
})

test('lots with no purchase date are treated as held the whole window (existing behavior)', () => {
  const asset = lotAsset({ symbol: 'LEGACY', currentPrice: 130, lots: [{ units: 10, cost: 1 }] })
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-LEGACY', [{ date: daysAgo(10), price: 100 }]]])
  const [mover] = computeMoversForWindow([asset], 100_000, priceHistory, 7, 'weekly').movers
  expect(mover.percentChange).toBeCloseTo(30, 5)
  expect(mover.dollarChange).toBeCloseTo(300, 5)
})

test('the same ticker held in two accounts aggregates into one position return', () => {
  const a = lotAsset({ symbol: 'DUO', currentPrice: 120, lots: [{ units: 10, cost: 1, boughtDaysAgo: 30 }] })
  const b = lotAsset({ symbol: 'DUO', currentPrice: 120, lots: [{ units: 10, cost: 100, boughtDaysAgo: 1 }] })
  const priceHistory = new Map<string, TickerPricePoint[]>([['t-DUO', [{ date: daysAgo(10), price: 80 }]]])
  const [mover] = computeMoversForWindow([a, b], 100_000, priceHistory, 7, 'weekly').movers
  expect(mover.dollarChange).toBeCloseTo(10 * (120 - 80) + 10 * (120 - 100), 5)
  expect(mover.percentChange).toBeCloseTo((600 / (800 + 1000)) * 100, 1) // movers round to 0.01%
})

test('a since-purchase move is worded as such in the teaser and flagged to the LLM', () => {
  const asset = lotAsset({ symbol: 'FRESH', currentPrice: 130, lots: [{ units: 10, cost: 100, boughtDaysAgo: 2 }] })
  const result = computeMoversForWindow([asset], 100_000, new Map(), 7, 'weekly')
  const slot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'FRESH', timeframe: 'weekly', windowDays: 7 }
  expect(buildSlotTeaser(slot, result, null)).toBe('FRESH moved +30.00% since you bought it. Want to know why?')

  const prompt = buildExplanationUserPrompt(result.movers, result.dayChangeDollars, result.dayChangePercent, result.themeMoves, [], undefined)
  expect(prompt).toMatch(/return since purchase/)
  // A position held the whole window keeps the plain wording.
  const held = lotAsset({ symbol: 'HELD', currentPrice: 130, lots: [{ units: 10, cost: 1, boughtDaysAgo: 40 }] })
  const heldResult = computeMoversForWindow([held], 100_000, new Map([['t-HELD', [{ date: daysAgo(10), price: 100 }]]]), 7, 'weekly')
  expect(buildSlotTeaser({ ...slot, scopeKey: 'HELD' }, heldResult, null)).toBe('HELD moved +30.00% this week. Want to know why?')
})

// ── Daily moves measure what the user held today ─────────────────────────

function dailyLotAsset(symbol: string, now: number, prev: number, lots: { units: number; cost: number; boughtToday?: boolean }[]) {
  return {
    asset_type: 'Stock',
    name: symbol,
    price: null,
    ticker: { id: `t-${symbol}`, symbol, current_price: now, previous_close: prev, ticker_themes: [] },
    stock_subtypes: [{
      transactions: lots.map(l => ({ count: String(l.units), cost_price: String(l.cost), ...(l.boughtToday ? { purchase_date: localDateKey() } : {}) })),
      rsu_grants: [],
    }],
  } as any
}

test('a stock up 20% on the day is not a major move for a position bought today near the current price', () => {
  const heldOvernight = [dailyLotAsset('AAA', 120, 100, [{ units: 10, cost: 90 }])]
  expect(computeMovers(heldOvernight, 100_000).hasMajorMove).toBe(true) // +20% held through the close

  const boughtToday = [dailyLotAsset('AAA', 120, 100, [{ units: 10, cost: 119, boughtToday: true }])]
  const result = computeMovers(boughtToday, 100_000)
  expect(result.hasMajorMove).toBe(false)
  expect(result.movers[0].percentChange).toBeCloseTo(0.84, 2)
  expect(result.movers[0].dollarChange).toBe(10)
  expect(result.movers[0].sinceBuy).toBe(true)
})

test('the daily teaser says "since you bought it" for a position opened today', () => {
  const assets = [dailyLotAsset('NEWB', 112, 90, [{ units: 10, cost: 100, boughtToday: true }])]
  const result = computeMovers(assets, 100_000)
  expect(result.hasMajorMove).toBe(true)
  const slot: PortfolioInsightSlot = { scope: 'stock', scopeKey: 'NEWB', timeframe: 'daily', windowDays: 1 }
  expect(buildSlotTeaser(slot, result, null)).toBe('NEWB moved +12.00% since you bought it. Want to know why?')
  // and the plain wording is untouched for a position held overnight
  const held = computeMovers([dailyLotAsset('OLDH', 112, 90, [{ units: 10, cost: 50 }])], 100_000)
  expect(buildSlotTeaser({ ...slot, scopeKey: 'OLDH' }, held, null)).toBe('OLDH moved +24.44% today. Want to know why?')
})

test('the same ticker in two accounts aggregates its daily move into one position return', () => {
  const a = dailyLotAsset('DUO', 110, 100, [{ units: 10, cost: 50 }])
  const b = dailyLotAsset('DUO', 110, 100, [{ units: 10, cost: 105, boughtToday: true }])
  const [mover] = computeMovers([a, b], 100_000).movers
  expect(mover.dollarChange).toBe(10 * 10 + 10 * 5)
  expect(mover.percentChange).toBeCloseTo((150 * 100) / (1000 + 1050), 1) // movers round to 0.01%
  expect(mover.sinceBuy).toBeUndefined()
})
