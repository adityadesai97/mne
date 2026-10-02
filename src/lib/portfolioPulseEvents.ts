// Portfolio Pulse event cards — the non-price-move insights that share the
// carousel with the stock/sector/portfolio move cards (see
// portfolioExplanation.ts's computeCandidateCards): an upcoming RSU vest, a
// lot about to turn long-term, a tax-loss-harvesting candidate, an
// allocation drifting from its theme target, and an upcoming earnings date.
//
// Everything here is pure JS over data already in memory (earnings dates
// are the one optional network fetch) — no LLM call. A card's click opens
// the command bar with a pre-filled question; nothing is submitted for the
// user. Educational framing only, never "you should sell".
//
// Every card carries a `score`: the share of net worth it puts at stake,
// in percent — the same scale as a price-move card's score, so the carousel
// can rank the two kinds together.

import { computeRsuVestEvents } from './charts'
import { computeAssetValue, computeShareCount, isTickerAsset, netCount } from './portfolio'
import { formatDateMDY } from './dates'
import { MAX_PULSE_CARDS, type PortfolioInsightSlot } from './portfolioExplanation'

export type PulseEventKind = 'rsu_vest' | 'long_term' | 'harvest' | 'allocation_drift' | 'earnings'

export interface PulseEvent {
  /** Stable per occurrence (includes the date) — what "seen" is keyed on. */
  id: string
  kind: PulseEventKind
  /** The one-line card text. */
  text: string
  /** Pre-filled into the command bar when the card is clicked. */
  question: string
  /** Percent of net worth at stake — the carousel's ranking score. */
  score: number
}

// ── Tunables ──────────────────────────────────────────────────────────────
export const RSU_VEST_LOOKAHEAD_DAYS = 14
export const LONG_TERM_LOOKAHEAD_DAYS = 30
/** Don't bother about a lot's tax treatment below this much unrealized gain. */
export const MIN_LONG_TERM_GAIN_DOLLARS = 500
/** A position this far under its cost basis (and by at least the dollar
 *  floor) reads as a tax-loss-harvesting candidate. */
export const HARVEST_MIN_LOSS_PCT = 15
export const HARVEST_MIN_LOSS_DOLLARS = 500
/** Percentage points a theme must sit from its target to be worth a card. */
export const ALLOCATION_DRIFT_PP = 5
export const EARNINGS_LOOKAHEAD_DAYS = 7
/** An earnings print typically moves a stock a few percent; score a card as
 *  that fraction of the position's weight in net worth. */
export const EARNINGS_TYPICAL_MOVE = 0.05
/** Earnings dates are looked up for only the largest holdings (one Finnhub
 *  call each). */
export const EARNINGS_MAX_SYMBOLS = 5

const DAY_MS = 86_400_000

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function daysUntil(target: Date, now: Date): number {
  return Math.round((utcMidnight(target) - utcMidnight(now)) / DAY_MS)
}

function inDays(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function fmtMoney(value: number): string {
  return `$${Math.round(Math.abs(value)).toLocaleString('en-US')}`
}

function fmtShares(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2)
}

function pctOfNetWorth(dollars: number, netWorth: number): number {
  return netWorth > 0 ? (Math.abs(dollars) / netWorth) * 100 : 0
}

function isoDate(date: Date): string {
  return new Date(utcMidnight(date)).toISOString().split('T')[0]
}

function openLots(asset: any): any[] {
  return (asset.stock_subtypes ?? []).flatMap((st: any) => st.transactions ?? []).filter((t: any) => netCount(t) > 0)
}

// ── RSU vests ─────────────────────────────────────────────────────────────

/** Vest events landing within RSU_VEST_LOOKAHEAD_DAYS, one card per symbol
 *  (the soonest date; shares summed across grants vesting that same day). A
 *  `continuous` grant has no discrete events and is skipped. */
export function computeRsuVestEventCards(assets: any[], netWorth: number, now: Date = new Date()): PulseEvent[] {
  const bySymbol = new Map<string, { days: number; shares: number; price: number; date: Date }>()
  for (const asset of assets) {
    const symbol = asset.ticker?.symbol
    if (!symbol) continue
    const price = Number(asset.ticker?.current_price) || 0
    for (const st of asset.stock_subtypes ?? []) {
      if (st.subtype !== 'RSU') continue
      for (const grant of st.rsu_grants ?? []) {
        if (grant.ended_at) continue
        for (const event of computeRsuVestEvents(grant)) {
          const days = daysUntil(event.date, now)
          if (days < 0 || days > RSU_VEST_LOOKAHEAD_DAYS || !(event.shares > 0)) continue
          const existing = bySymbol.get(symbol)
          if (!existing || days < existing.days) {
            bySymbol.set(symbol, { days, shares: event.shares, price, date: event.date })
          } else if (days === existing.days) {
            existing.shares += event.shares
          }
        }
      }
    }
  }
  return [...bySymbol.entries()].map(([symbol, v]) => {
    const value = v.shares * v.price
    return {
      id: `rsu_vest:${symbol}:${isoDate(v.date)}`,
      kind: 'rsu_vest' as const,
      text: `${fmtShares(v.shares)} ${symbol} RSU shares vest ${inDays(v.days)}${value > 0 ? ` (about ${fmtMoney(value)})` : ''}.`,
      question: 'How many RSU shares vest in the next 30 days?',
      score: pctOfNetWorth(value, netWorth),
    }
  })
}

// ── Lots about to turn long-term ──────────────────────────────────────────

/** Short Term lots whose one-year mark lands within LONG_TERM_LOOKAHEAD_DAYS
 *  and that carry a meaningful unrealized gain — one card per symbol. This
 *  is the same date promoteStaleShortTermLots flips a lot on. */
export function computeLongTermEventCards(assets: any[], netWorth: number, now: Date = new Date()): PulseEvent[] {
  const bySymbol = new Map<string, { gain: number; days: number; lots: number }>()
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const symbol = asset.ticker?.symbol
    const price = Number(asset.ticker?.current_price)
    if (!symbol || !Number.isFinite(price)) continue
    for (const lot of openLots(asset)) {
      if (lot.capital_gains_status !== 'Short Term' || typeof lot.purchase_date !== 'string') continue
      const purchased = new Date(`${lot.purchase_date.slice(0, 10)}T00:00:00Z`)
      if (Number.isNaN(purchased.getTime())) continue
      const longTermOn = new Date(purchased)
      longTermOn.setUTCFullYear(longTermOn.getUTCFullYear() + 1)
      const days = daysUntil(longTermOn, now)
      if (days < 0 || days > LONG_TERM_LOOKAHEAD_DAYS) continue
      const gain = netCount(lot) * (price - Number(lot.cost_price))
      if (gain <= 0) continue
      const existing = bySymbol.get(symbol) ?? { gain: 0, days, lots: 0 }
      existing.gain += gain
      existing.days = Math.min(existing.days, days)
      existing.lots += 1
      bySymbol.set(symbol, existing)
    }
  }
  return [...bySymbol.entries()]
    .filter(([, v]) => v.gain >= MIN_LONG_TERM_GAIN_DOLLARS)
    .map(([symbol, v]) => ({
      id: `long_term:${symbol}:${isoDate(now)}`,
      kind: 'long_term' as const,
      text: `${v.lots === 1 ? 'A lot' : `${v.lots} lots`} of ${symbol} turn${v.lots === 1 ? 's' : ''} long-term ${inDays(v.days)} — about ${fmtMoney(v.gain)} of unrealized gain that would move to the lower long-term rate.`,
      question: `What are the tax implications of selling my ${symbol} lots before versus after they turn long-term?`,
      score: pctOfNetWorth(v.gain, netWorth),
    }))
}

// ── Tax-loss-harvest candidates ───────────────────────────────────────────

/** Positions meaningfully under their cost basis. Doesn't know whether the
 *  account is taxable, so the wording stays "possible candidate". */
export function computeHarvestEventCards(assets: any[], netWorth: number, now: Date = new Date()): PulseEvent[] {
  const bySymbol = new Map<string, { value: number; cost: number }>()
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const symbol = asset.ticker?.symbol
    const price = Number(asset.ticker?.current_price)
    if (!symbol || !Number.isFinite(price) || price <= 0) continue
    const shares = computeShareCount(asset)
    if (shares <= 0) continue
    const cost = openLots(asset).reduce((sum: number, t: any) => sum + netCount(t) * Number(t.cost_price), 0)
    const existing = bySymbol.get(symbol) ?? { value: 0, cost: 0 }
    existing.value += shares * price
    existing.cost += cost
    bySymbol.set(symbol, existing)
  }
  return [...bySymbol.entries()].flatMap(([symbol, v]) => {
    const loss = v.cost - v.value
    const lossPct = v.cost > 0 ? (loss / v.cost) * 100 : 0
    if (loss < HARVEST_MIN_LOSS_DOLLARS || lossPct < HARVEST_MIN_LOSS_PCT) return []
    return [{
      id: `harvest:${symbol}:${isoDate(now).slice(0, 7)}`,
      kind: 'harvest' as const,
      text: `${symbol} is ${Math.round(lossPct)}% below your cost basis (about ${fmtMoney(loss)} unrealized loss) — a possible tax-loss-harvesting candidate.`,
      question: `Is ${symbol} a good tax-loss harvesting candidate, and what should I watch out for?`,
      score: pctOfNetWorth(loss, netWorth),
    }]
  })
}

// ── Allocation drift ──────────────────────────────────────────────────────

/** Themes (with a `theme_targets` row) sitting ALLOCATION_DRIFT_PP or more
 *  away from their target share of the ticker-held portfolio. Shares are
 *  computed the same way the theme distribution chart does: a holding in
 *  several themes counts evenly across them. */
export function computeAllocationDriftEventCards(
  assets: any[],
  themes: { name: string; theme_targets?: { target_percentage: number | string }[] | null }[],
  netWorth: number,
  now: Date = new Date(),
): PulseEvent[] {
  const byTheme = new Map<string, number>()
  let total = 0
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const value = computeAssetValue(asset)
    if (!(value > 0)) continue
    total += value
    const names = Array.from(new Set<string>(
      (asset.ticker?.ticker_themes ?? []).map((tt: any) => String(tt?.theme?.name ?? '').trim()).filter((n: string) => n.length > 0),
    ))
    const buckets = names.length > 0 ? names : ['Uncategorized']
    for (const name of buckets) byTheme.set(name, (byTheme.get(name) ?? 0) + value / buckets.length)
  }
  if (total <= 0) return []

  return themes.flatMap(theme => {
    const target = Number(theme.theme_targets?.[0]?.target_percentage)
    if (!Number.isFinite(target)) return []
    const actual = ((byTheme.get(theme.name) ?? 0) / total) * 100
    const drift = actual - target
    if (Math.abs(drift) < ALLOCATION_DRIFT_PP) return []
    const dollars = (Math.abs(drift) / 100) * total
    return [{
      id: `allocation_drift:${theme.name}:${isoDate(now).slice(0, 7)}`,
      kind: 'allocation_drift' as const,
      text: `${theme.name} is ${Math.round(actual)}% of your holdings against a ${Math.round(target)}% target (${drift > 0 ? '+' : '−'}${Math.abs(drift).toFixed(0)} pts).`,
      question: `My ${theme.name} allocation is ${actual.toFixed(0)}% against a ${target.toFixed(0)}% target — how could I rebalance?`,
      score: pctOfNetWorth(dollars, netWorth),
    }]
  })
}

// ── Earnings ──────────────────────────────────────────────────────────────

const earningsCache = new Map<string, Promise<string | null>>()

/** The soonest earnings date (YYYY-MM-DD) for `symbol` within the lookahead,
 *  or null. Finnhub's free `calendar/earnings`; cached per symbol for the
 *  page load, and best-effort — any failure is just "no date known". */
function fetchEarningsDate(symbol: string, finnhubApiKey: string, now: Date): Promise<string | null> {
  const key = `${symbol}:${isoDate(now)}`
  const cached = earningsCache.get(key)
  if (cached) return cached
  const from = isoDate(now)
  const to = isoDate(new Date(utcMidnight(now) + EARNINGS_LOOKAHEAD_DAYS * DAY_MS))
  const promise = (async () => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}&token=${finnhubApiKey}`)
      const json = await res.json()
      const dates = (Array.isArray(json?.earningsCalendar) ? json.earningsCalendar : [])
        .map((e: any) => (typeof e?.date === 'string' ? e.date : ''))
        .filter((d: string) => d >= from && d <= to)
        .sort()
      return dates[0] ?? null
    } catch {
      return null
    }
  })()
  earningsCache.set(key, promise)
  return promise
}

/** The symbols worth an earnings lookup: the largest (by value) *stock*
 *  holdings, by position — crypto has no earnings. */
export function earningsLookupSymbols(assets: any[]): string[] {
  const valueBySymbol = new Map<string, number>()
  for (const asset of assets) {
    if (asset.asset_type !== 'Stock') continue
    const symbol = asset.ticker?.symbol
    if (!symbol) continue
    valueBySymbol.set(symbol, (valueBySymbol.get(symbol) ?? 0) + computeAssetValue(asset))
  }
  return [...valueBySymbol.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, EARNINGS_MAX_SYMBOLS)
    .map(([symbol]) => symbol)
}

/** Looks up upcoming earnings dates for the largest holdings. Returns
 *  symbol → date. Empty without a Finnhub key. */
export async function fetchUpcomingEarnings(assets: any[], finnhubApiKey: string, now: Date = new Date()): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!finnhubApiKey) return result
  await Promise.all(earningsLookupSymbols(assets).map(async symbol => {
    const date = await fetchEarningsDate(symbol, finnhubApiKey, now)
    if (date) result.set(symbol, date)
  }))
  return result
}

export function computeEarningsEventCards(
  assets: any[],
  earnings: Map<string, string>,
  netWorth: number,
  now: Date = new Date(),
): PulseEvent[] {
  const valueBySymbol = new Map<string, number>()
  for (const asset of assets) {
    const symbol = asset.ticker?.symbol
    if (symbol && earnings.has(symbol)) valueBySymbol.set(symbol, (valueBySymbol.get(symbol) ?? 0) + computeAssetValue(asset))
  }
  return [...earnings.entries()].flatMap(([symbol, date]) => {
    const days = daysUntil(new Date(`${date}T00:00:00Z`), now)
    const value = valueBySymbol.get(symbol) ?? 0
    if (days < 0 || days > EARNINGS_LOOKAHEAD_DAYS || value <= 0) return []
    return [{
      id: `earnings:${symbol}:${date}`,
      kind: 'earnings' as const,
      text: `${symbol} reports earnings ${inDays(days)} (${formatDateMDY(date)}) — ${(pctOfNetWorth(value, netWorth)).toFixed(1)}% of your net worth.`,
      question: `What should I know about ${symbol}'s upcoming earnings?`,
      score: pctOfNetWorth(value, netWorth) * EARNINGS_TYPICAL_MOVE,
    }]
  })
}

/** All the synchronous event cards (everything except earnings, which needs
 *  the fetched dates — see computeEarningsEventCards). */
export function computeEventCards(
  assets: any[],
  netWorth: number,
  themes: { name: string; theme_targets?: { target_percentage: number | string }[] | null }[],
  earnings: Map<string, string> = new Map(),
  now: Date = new Date(),
): PulseEvent[] {
  return [
    ...computeRsuVestEventCards(assets, netWorth, now),
    ...computeLongTermEventCards(assets, netWorth, now),
    ...computeHarvestEventCards(assets, netWorth, now),
    ...computeAllocationDriftEventCards(assets, themes, netWorth, now),
    ...computeEarningsEventCards(assets, earnings, netWorth, now),
  ]
}

// ── Merging price-move and event cards ────────────────────────────────────

export type PulseItem =
  | { type: 'move'; key: string; slot: PortfolioInsightSlot; teaser: string; tag?: string; score: number; seen: boolean }
  | { type: 'event'; key: string; event: PulseEvent; seen: boolean }

export function pulseItemScore(item: PulseItem): number {
  return item.type === 'move' ? item.score : item.event.score
}

/** Orders the carousel: anything the user hasn't dealt with yet comes first
 *  (an already-opened, unchanged price move or an already-opened event is
 *  demoted behind it), each group ranked by net-worth impact; then capped.
 *  A seen card still fills a spot when there's room, it just never pushes a
 *  fresh one out. */
export function rankPulseItems(items: PulseItem[], max: number = MAX_PULSE_CARDS): PulseItem[] {
  return [...items]
    .sort((a, b) => Number(a.seen) - Number(b.seen) || pulseItemScore(b) - pulseItemScore(a))
    .slice(0, max)
}

// ── "Seen" memory for event cards ─────────────────────────────────────────
// Price-move cards know whether they've been read from their stored
// explanation row; event cards have none, so opened ones are remembered
// per-occurrence (the id includes the date) in localStorage. A per-viewer
// convenience — all access is best-effort.

const SEEN_EVENTS_KEY = 'mne_pulse_seen_events'
const SEEN_EVENTS_MAX = 100

export function loadSeenEventIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_EVENTS_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markEventSeen(id: string): Set<string> {
  const seen = loadSeenEventIds()
  seen.add(id)
  try {
    localStorage.setItem(SEEN_EVENTS_KEY, JSON.stringify([...seen].slice(-SEEN_EVENTS_MAX)))
  } catch { /* storage unavailable — the card just won't be demoted */ }
  return seen
}
