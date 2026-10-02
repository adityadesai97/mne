import { isTickerAsset, netCount } from './portfolio'
import type { TickerPricePoint } from './db/tickerPriceHistory'

/** How far back from a date we'll reach for a ticker's last recorded price
 *  (covers weekends/holidays; beyond this the price is too stale to trust). */
export const MAX_PRICE_STALENESS_DAYS = 5

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
}

/** Latest recorded price on or before `date`, or null if there isn't one
 *  within MAX_PRICE_STALENESS_DAYS. `points` is sorted oldest-first. */
export function priceOnOrBefore(points: TickerPricePoint[] | undefined, date: string): number | null {
  if (!points) return null
  let found: TickerPricePoint | null = null
  for (const p of points) {
    if (p.date > date) break
    found = p
  }
  if (!found || daysBetween(found.date, date) > MAX_PRICE_STALENESS_DAYS) return null
  return found.price
}

/** Value of every stock/crypto holding as of `date`: lots bought on or
 *  before it (a lot with no purchase_date counts as held), at that day's
 *  recorded price. Returns null if any held ticker has no usable price —
 *  a partial sum would understate net worth, which is the bug this exists
 *  to avoid. */
export function tickerAssetsValueOn(
  assets: any[],
  priceHistory: Map<string, TickerPricePoint[]>,
  date: string,
): number | null {
  let total = 0
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const shares = (asset.stock_subtypes ?? [])
      .flatMap((st: any) => st.transactions ?? [])
      .filter((t: any) => !t.purchase_date || t.purchase_date <= date)
      .reduce((sum: number, t: any) => sum + netCount(t), 0)
    if (shares <= 0) continue
    const price = priceOnOrBefore(priceHistory.get(asset.ticker?.id), date)
    if (price == null) return null
    total += shares * price
  }
  return total
}

/** Estimates net worth on a day that has no real snapshot, anchored on the
 *  nearest earlier real one: anchor total + the change in stock/crypto value
 *  between the anchor day and `date`. Cash, 401k, HSA, CDs and the like
 *  cancel out, i.e. they're assumed unchanged since the anchor — there's no
 *  history of those balances, and over a short gap that's the best guess.
 *  Returns null when there's no earlier anchor or a price is missing. */
export function estimateNetWorthOn(
  date: string,
  anchor: { date: string; value: number } | undefined,
  assets: any[],
  priceHistory: Map<string, TickerPricePoint[]>,
): number | null {
  if (!anchor || anchor.date >= date) return null
  const atTarget = tickerAssetsValueOn(assets, priceHistory, date)
  const atAnchor = tickerAssetsValueOn(assets, priceHistory, anchor.date)
  if (atTarget == null || atAnchor == null) return null
  const value = anchor.value + (atTarget - atAnchor)
  return value > 0 ? Math.round(value * 100) / 100 : null
}
