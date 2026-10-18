import { isUsMarketClosed, lastSessionBefore } from '../lib/marketCalendar'
import { computeLastSessionEventCards, computeEventCards } from '../lib/portfolioPulseEvents'

test('market calendar: weekends and NYSE holidays are closed, other days open', () => {
  expect(isUsMarketClosed('2026-10-17')).toBe(true) // Saturday
  expect(isUsMarketClosed('2026-10-18')).toBe(true) // Sunday
  expect(isUsMarketClosed('2026-10-16')).toBe(false)
  expect(isUsMarketClosed('2026-04-03')).toBe(true) // Good Friday (Easter is Apr 5)
  expect(isUsMarketClosed('2026-07-03')).toBe(true) // Jul 4 is a Saturday: observed Friday
  expect(isUsMarketClosed('2026-11-26')).toBe(true) // Thanksgiving
  expect(isUsMarketClosed('2026-11-27')).toBe(false) // early close, still a session
  expect(isUsMarketClosed('2027-01-01')).toBe(true)
  expect(isUsMarketClosed('2022-12-30')).toBe(false) // Jan 1 2022 was a Saturday: not observed
  expect(isUsMarketClosed('2026-09-07')).toBe(true) // Labor Day
})

test('last session is the previous trading day', () => {
  expect(lastSessionBefore('2026-10-18')).toBe('2026-10-16')
  expect(lastSessionBefore('2026-09-08')).toBe('2026-09-04') // after Labor Day weekend
  expect(lastSessionBefore('2026-10-16')).toBe('2026-10-15')
})

const stock = (price: number, prev: number) => ({
  id: 'a', name: 'CRM', asset_type: 'Stock', price: null,
  ticker: { id: 't', symbol: 'CRM', current_price: price, previous_close: prev },
  stock_subtypes: [{ subtype: 'Market', transactions: [{ count: 100, cost_price: 50, purchase_date: '2020-01-01' }], rsu_grants: [] }],
}) as any
const cash = { id: 'c', name: 'Cash', asset_type: 'Cash', price: 90000, ticker: null, stock_subtypes: [] } as any
const assets = [stock(98, 100), cash] // -$200 on $99,800 = -0.2%... scaled below
const big = [stock(100, 110), { ...cash, price: 5000 }] // -$1000 on $15,000 = -6.67%

const saturday = new Date(2026, 9, 17, 12)
const wednesday = new Date(2026, 9, 14, 12)

test('last-session card appears only on closed-market days, for a meaningful move that differs from the daily figure', () => {
  const netWorth = 15000
  const cards = computeLastSessionEventCards(big, netWorth, { percentChange: 0.12 }, saturday)
  expect(cards).toHaveLength(1)
  expect(cards[0].kind).toBe('last_session')
  expect(cards[0].id).toBe('last_session:2026-10-16')
  expect(cards[0].text).toContain("Friday's session")
  expect(cards[0].delta).toBeLessThan(0)
  expect(cards[0].score).toBeCloseTo(6.67, 1)

  // Open market day: the daily card already covers it.
  expect(computeLastSessionEventCards(big, netWorth, { percentChange: 0.12 }, wednesday)).toEqual([])
  // Same as the Net worth card's own figure: nothing new to say.
  expect(computeLastSessionEventCards(big, netWorth, { percentChange: -6.5 }, saturday)).toEqual([])
  // Too small a move.
  expect(computeLastSessionEventCards(assets, 99800, { percentChange: 0 }, saturday)).toEqual([])
  // Included in the combined event list.
  expect(computeEventCards(big, netWorth, [], new Map(), saturday, { percentChange: 0.12 }).some(e => e.kind === 'last_session')).toBe(true)
})
