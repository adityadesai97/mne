import { estimateNetWorthOn, priceOnOrBefore, tickerAssetsValueOn } from '../lib/snapshotBackfill'
import type { TickerPricePoint } from '../lib/db/tickerPriceHistory'

function tickerAsset(id: string, lots: { count: number; purchase_date?: string | null }[], type = 'Stock'): any {
  return {
    asset_type: type, price: null, ticker: { id, current_price: 0 },
    stock_subtypes: [{ transactions: lots.map(l => ({ cost_price: 1, sold_at_vest: 0, ...l })) }],
  }
}
const cash = (price: number): any => ({ asset_type: 'Cash', price, ticker: null, stock_subtypes: null })
const hist = (...pts: [string, number][]): TickerPricePoint[] => pts.map(([date, price]) => ({ date, price }))

test('priceOnOrBefore uses the latest earlier price within the staleness window, else null', () => {
  const pts = hist(['2026-09-24', 10], ['2026-09-26', 12])
  expect(priceOnOrBefore(pts, '2026-09-26')).toBe(12)
  expect(priceOnOrBefore(pts, '2026-09-28')).toBe(12)
  expect(priceOnOrBefore(pts, '2026-09-23')).toBeNull()
  expect(priceOnOrBefore(pts, '2026-10-20')).toBeNull()
  expect(priceOnOrBefore(undefined, '2026-09-26')).toBeNull()
})

test('tickerAssetsValueOn counts only lots held by the date and ignores non-ticker assets', () => {
  const assets = [tickerAsset('t1', [{ count: 10, purchase_date: '2026-09-01' }, { count: 5, purchase_date: '2026-09-27' }]), cash(50_000)]
  const prices = new Map([['t1', hist(['2026-09-24', 100], ['2026-09-27', 110])]])
  expect(tickerAssetsValueOn(assets, prices, '2026-09-24')).toBe(1000)
  expect(tickerAssetsValueOn(assets, prices, '2026-09-27')).toBe(15 * 110)
})

test('tickerAssetsValueOn returns null if a held ticker has no usable price (no partial sum)', () => {
  const assets = [tickerAsset('t1', [{ count: 1, purchase_date: '2026-01-01' }]), tickerAsset('t2', [{ count: 1, purchase_date: '2026-01-01' }])]
  const prices = new Map([['t1', hist(['2026-09-24', 100])]])
  expect(tickerAssetsValueOn(assets, prices, '2026-09-24')).toBeNull()
})

test('estimateNetWorthOn keeps non-ticker balances at their anchor value instead of dropping them (the Sep 27 bug)', () => {
  // $1.29M real total on 9/24 = $600K of stock + $690K of cash/401k. A QNT buy
  // on 9/27 and a small price move must NOT collapse the total to stocks-only.
  const assets = [tickerAsset('t1', [{ count: 6000, purchase_date: '2026-01-01' }]), tickerAsset('q', [{ count: 100, purchase_date: '2026-09-27' }], 'Crypto'), cash(690_000)]
  const prices = new Map([
    ['t1', hist(['2026-09-24', 100], ['2026-09-27', 101])],
    ['q', hist(['2026-09-24', 50], ['2026-09-27', 50])],
  ])
  const est = estimateNetWorthOn('2026-09-27', { date: '2026-09-24', value: 1_290_000 }, assets, prices)
  expect(est).toBe(1_290_000 + 6000 * 1 + 100 * 50)
})

test('estimateNetWorthOn returns null without an earlier anchor or a price', () => {
  const assets = [tickerAsset('t1', [{ count: 1, purchase_date: '2026-01-01' }])]
  const prices = new Map([['t1', hist(['2026-09-24', 100])]])
  expect(estimateNetWorthOn('2026-09-27', undefined, assets, prices)).toBeNull()
  expect(estimateNetWorthOn('2026-09-27', { date: '2026-09-27', value: 1 }, assets, prices)).toBeNull()
  expect(estimateNetWorthOn('2026-09-27', { date: '2026-09-01', value: 1000 }, assets, prices)).toBeNull()
})
