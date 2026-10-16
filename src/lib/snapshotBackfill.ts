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
  nextReal?: { date: string; value: number },
): number | null {
  if (!anchor || anchor.date >= date) return null
  const atTarget = tickerAssetsValueOn(assets, priceHistory, date)
  const atAnchor = tickerAssetsValueOn(assets, priceHistory, anchor.date)
  if (atTarget == null || atAnchor == null) return null
  const value = anchor.value + (atTarget - atAnchor)
  if (!(value > 0)) return null
  const rounded = Math.round(value * 100) / 100
  // Plausibility guard: a day-level estimate must sit near the real snapshots
  // on either side. Net worth doesn't move by more than ~35% between nearby
  // real readings through market moves alone; a result that far off means a
  // bad anchor, a bad/mis-scaled historical price, or holdings that the
  // current lots don't describe. Better a gap than a spike to near zero.
  if (!isPlausibleBackfill(rounded, anchor.value)) return null
  if (nextReal && !isPlausibleBackfill(rounded, nextReal.value)) return null
  return rounded
}

/** Max relative distance (as a fraction of the reference) an estimated
 *  snapshot may sit from a neighbouring real snapshot. */
export const MAX_BACKFILL_DEVIATION = 0.35

export function isPlausibleBackfill(value: number, reference: number): boolean {
  if (!(reference > 0)) return false
  return Math.abs(value - reference) / reference <= MAX_BACKFILL_DEVIATION
}

/** A snapshot is a "dip outlier" when it is below 60% of BOTH neighbours
 *  while those neighbours agree with each other (within 25%) — a lone point
 *  that fell off a cliff and came straight back, which no real portfolio does
 *  (it's a partial load, a zero, or a bad backfill estimate). */
export function findDipOutliers(points: { date: string; value: number }[]): Set<string> {
  const out = new Set<string>()
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1].value
    const next = points[i + 1].value
    const lo = Math.min(prev, next)
    const hi = Math.max(prev, next)
    if (lo > 0 && (hi - lo) / lo <= 0.25 && points[i].value < 0.6 * lo) out.add(points[i].date)
  }
  return out
}

/** DISPLAY GUARD ONLY: drops lone dip outliers from a series before charting.
 *  Stored rows are untouched; the real fix is not writing them (see
 *  backfillHistoricalSnapshots / recordDailySnapshot). */
export function dropDipOutliers<T extends { date: string; value: number }>(points: T[]): T[] {
  const bad = findDipOutliers(points)
  return bad.size === 0 ? points : points.filter(p => !bad.has(p.date))
}

/** False when any ticker holding can't be valued (no current price), so a
 *  net worth computed from these assets would silently count it as $0. */
export function isNetWorthComplete(assets: any[]): boolean {
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const shares = (asset.stock_subtypes ?? [])
      .flatMap((st: any) => st.transactions ?? [])
      .reduce((sum: number, t: any) => sum + netCount(t), 0)
    if (shares <= 0) continue
    const price = asset.ticker?.current_price
    if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return false
  }
  return true
}
