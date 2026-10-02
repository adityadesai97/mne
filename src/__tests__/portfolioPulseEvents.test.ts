import {
  computeRsuVestEventCards, computeLongTermEventCards, computeHarvestEventCards, computeAllocationDriftEventCards,
  computeEarningsEventCards, earningsLookupSymbols, rankPulseItems, type PulseItem, type PulseEvent,
} from '../lib/portfolioPulseEvents'

const NOW = new Date('2026-10-02T12:00:00Z')

function isoDaysFromNow(days: number): string {
  return new Date(Date.UTC(2026, 9, 2) + days * 86_400_000).toISOString().split('T')[0]
}

function asset(opts: {
  symbol: string
  price: number
  type?: string
  lots?: { count: number; cost: number; status?: string; purchased?: string }[]
  themes?: string[]
  grants?: any[]
}) {
  return {
    asset_type: opts.type ?? 'Stock',
    name: opts.symbol,
    price: null,
    ticker: {
      id: `t-${opts.symbol}`, symbol: opts.symbol, current_price: opts.price, previous_close: opts.price,
      ticker_themes: (opts.themes ?? []).map(name => ({ theme: { name } })),
    },
    stock_subtypes: [{
      subtype: opts.grants ? 'RSU' : 'Market',
      transactions: (opts.lots ?? []).map(l => ({
        count: String(l.count), cost_price: String(l.cost),
        capital_gains_status: l.status ?? 'Long Term', purchase_date: l.purchased,
      })),
      rsu_grants: opts.grants ?? [],
    }],
  } as any
}

test('an RSU vest within two weeks becomes a card; one farther out does not', () => {
  const grant = (vestDate: string) => ({
    grant_date: '2025-01-01', vest_start: vestDate, cliff_date: vestDate, vest_end: vestDate, total_shares: 100,
    vesting_frequency: 'annually',
  })
  const soon = asset({ symbol: 'ACME', price: 50, grants: [grant(isoDaysFromNow(5))] })
  const [card] = computeRsuVestEventCards([soon], 100_000, NOW)
  expect(card.kind).toBe('rsu_vest')
  expect(card.text).toBe('100 ACME RSU shares vest in 5 days (about $5,000).')
  expect(card.score).toBeCloseTo(5, 5)

  const later = asset({ symbol: 'ACME', price: 50, grants: [grant(isoDaysFromNow(40))] })
  expect(computeRsuVestEventCards([later], 100_000, NOW)).toEqual([])
})

test('a short-term lot reaching one year within a month, with a real gain, becomes a card', () => {
  const lots = [{ count: 100, cost: 50, status: 'Short Term', purchased: isoDaysFromNow(-350) }] // turns long-term in 15 days
  const [card] = computeLongTermEventCards([asset({ symbol: 'NVDA', price: 80, lots })], 100_000, NOW)
  expect(card.kind).toBe('long_term')
  expect(card.text).toContain('A lot of NVDA turns long-term in 15 days')
  expect(card.text).toContain('$3,000')

  // Too far away, already long-term, or underwater: no card.
  const far = [{ count: 100, cost: 50, status: 'Short Term', purchased: isoDaysFromNow(-200) }]
  const alreadyLong = [{ count: 100, cost: 50, status: 'Long Term', purchased: isoDaysFromNow(-350) }]
  const loss = [{ count: 100, cost: 90, status: 'Short Term', purchased: isoDaysFromNow(-350) }]
  for (const l of [far, alreadyLong, loss]) {
    expect(computeLongTermEventCards([asset({ symbol: 'NVDA', price: 80, lots: l })], 100_000, NOW)).toEqual([])
  }
})

test('a position well under its cost basis is a harvest candidate; a small or shallow loss is not', () => {
  const deep = asset({ symbol: 'DOWN', price: 70, lots: [{ count: 100, cost: 100 }] }) // -30%, -$3,000
  const [card] = computeHarvestEventCards([deep], 100_000, NOW)
  expect(card.kind).toBe('harvest')
  expect(card.text).toContain('30% below your cost basis')
  expect(card.text).toContain('$3,000')

  const shallow = asset({ symbol: 'MEH', price: 95, lots: [{ count: 1000, cost: 100 }] }) // -5%
  const tiny = asset({ symbol: 'TINY', price: 50, lots: [{ count: 5, cost: 100 }] }) // -50%, only $250
  expect(computeHarvestEventCards([shallow, tiny], 100_000, NOW)).toEqual([])
})

test('a theme far from its target allocation becomes a card', () => {
  const assets = [
    asset({ symbol: 'NVDA', price: 100, lots: [{ count: 70, cost: 1 }], themes: ['AI'] }), // $7,000
    asset({ symbol: 'KO', price: 100, lots: [{ count: 30, cost: 1 }], themes: ['Staples'] }), // $3,000
  ]
  const themes = [
    { name: 'AI', theme_targets: [{ target_percentage: 50 }] },
    { name: 'Staples', theme_targets: [{ target_percentage: 28 }] }, // within 5 pts
    { name: 'Energy' }, // no target
  ]
  const cards = computeAllocationDriftEventCards(assets, themes, 10_000, NOW)
  expect(cards).toHaveLength(1)
  expect(cards[0].text).toBe('AI is 70% of your holdings against a 50% target (+20 pts).')
})

test('earnings within a week become a card sized by position weight', () => {
  const assets = [asset({ symbol: 'AAPL', price: 100, lots: [{ count: 100, cost: 1 }] })]
  const [card] = computeEarningsEventCards(assets, new Map([['AAPL', isoDaysFromNow(3)]]), 50_000, NOW)
  expect(card.text).toContain('AAPL reports earnings in 3 days')
  expect(card.score).toBeCloseTo((10_000 / 50_000) * 100 * 0.05, 5)
  expect(computeEarningsEventCards(assets, new Map([['AAPL', isoDaysFromNow(20)]]), 50_000, NOW)).toEqual([])
})

test('earnings lookups cover only the largest stock holdings, never crypto', () => {
  const stocks = Array.from({ length: 7 }, (_, i) => asset({ symbol: `S${i}`, price: 10 + i, lots: [{ count: 10, cost: 1 }] }))
  const coin = asset({ symbol: 'BTC', price: 1_000_000, type: 'Crypto', lots: [{ count: 1, cost: 1 }] })
  const symbols = earningsLookupSymbols([...stocks, coin])
  expect(symbols).toHaveLength(5)
  expect(symbols).not.toContain('BTC')
  expect(symbols[0]).toBe('S6')
})

function eventItem(id: string, score: number, seen = false): PulseItem {
  const event: PulseEvent = { id, kind: 'earnings', text: id, question: id, score }
  return { type: 'event', key: id, event, seen }
}
function moveItem(key: string, score: number, seen = false): PulseItem {
  return { type: 'move', key, slot: { scope: 'stock', scopeKey: key, timeframe: 'daily', windowDays: 1 }, teaser: key, score, seen }
}

test('rankPulseItems ranks by score, demotes seen cards, and caps the list', () => {
  const ranked = rankPulseItems([moveItem('a', 1, true), eventItem('b', 0.2), moveItem('c', 3), eventItem('d', 0.1, true)], 3)
  expect(ranked.map(i => i.key)).toEqual(['c', 'b', 'a']) // fresh by score, then the best seen one
})
