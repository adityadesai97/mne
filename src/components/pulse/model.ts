// View-model for a Portfolio Pulse card: turns a ranked PulseItem (price move
// or event) into the few things both layouts render — headline, chips, a big
// figure (signed delta or countdown) and an optional decorative visual. Pure
// functions over data PortfolioPulseCarousel already holds; nothing fetched.
import { TrendingUp, TrendingDown, CalendarClock, Gift, Percent, Scale, CalendarDays, type LucideIcon } from 'lucide-react'
import { computeRsuVestEvents } from '@/lib/charts'
import { computeAssetValue, computeShareCount, isTickerAsset, netCount } from '@/lib/portfolio'
import type { MoversResult, PortfolioInsightSlot } from '@/lib/portfolioExplanation'
import type { PulseItem, PulseEvent } from '@/lib/portfolioPulseEvents'
import type { TickerPricePoint } from '@/lib/db/tickerPriceHistory'

export type PulseVisual =
  | { kind: 'spark'; values: number[]; dir: 'up' | 'down'; base?: number }
  | { kind: 'progress'; pct: number; label: string }
  | { kind: 'vest'; done: number; total: number; label: string }
  | { kind: 'target'; actual: number; target: number; label: string }

export interface PulseCardModel {
  key: string
  kind: 'move' | PulseEvent['kind']
  icon: LucideIcon
  text: string
  /** "Why now" tag for a move, or the event's name. */
  tag?: string
  /** Tag chip look: amber for a why-now tag, outline for an event name. */
  tagVariant: 'tag' | 'outline'
  timeframe?: string
  seen: boolean
  /** Signed percent shown as a ▲/▼ figure. */
  delta?: number
  /** Countdown or other plain figure when there is no delta ("21 days"). */
  metric?: string
  /** Small caption under the figure ("today", "to 1 year"). */
  unit: string
  visual: PulseVisual | null
  item: PulseItem
}

export const TIMEFRAME_LABEL: Record<string, string> = {
  daily: 'Today',
  weekly: 'This week',
  monthly: 'This month',
  yearly: 'This year',
  custom: 'Notable move',
}
const TIMEFRAME_UNIT: Record<string, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
  yearly: 'this year',
  custom: 'notable move',
}
export const EVENT_LABEL: Record<string, string> = {
  rsu_vest: 'RSU vest',
  long_term: 'Long term',
  harvest: 'Tax-loss candidate',
  allocation_drift: 'Allocation drift',
  earnings: 'Earnings',
}
const EVENT_ICON: Record<string, LucideIcon> = {
  rsu_vest: Gift,
  long_term: CalendarClock,
  harvest: Percent,
  allocation_drift: Scale,
  earnings: CalendarDays,
}

const DAY_MS = 86_400_000
const MIN_SPARK_POINTS = 3

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
function daysFromToday(date: Date, now: Date): number {
  return Math.round((utcDay(date) - utcDay(now)) / DAY_MS)
}
function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}
function countdown(days: number): string {
  return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`
}

// ── Sparklines from ticker_price_history ──────────────────────────────────

function windowCutoff(days: number, now: Date): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().split('T')[0]
}

/** Value over time of the ticker assets passing `include`, at the window's
 *  daily closes plus the live price as the last point. A holding only joins
 *  once it has a recorded price, so a newly added ticker never fakes a jump. */
export function seriesForAssets(
  assets: any[],
  history: Map<string, TickerPricePoint[]>,
  include: (asset: any) => boolean,
  windowDays: number,
  now: Date = new Date(),
): number[] {
  const cutoff = windowCutoff(windowDays, now)
  const held = assets.filter(a => isTickerAsset(a) && a.ticker?.id && include(a) && computeShareCount(a) > 0)
  if (held.length === 0) return []
  const perTicker = new Map<string, { shares: number; points: TickerPricePoint[]; live: number }>()
  for (const a of held) {
    const id = a.ticker.id as string
    const entry = perTicker.get(id) ?? { shares: 0, points: (history.get(id) ?? []).filter(p => p.date >= cutoff), live: Number(a.ticker.current_price) }
    entry.shares += computeShareCount(a)
    perTicker.set(id, entry)
  }
  const dates = [...new Set([...perTicker.values()].flatMap(t => t.points.map(p => p.date)))].sort()
  const out: number[] = []
  for (const date of dates) {
    let total = 0
    let complete = true
    for (const t of perTicker.values()) {
      let price: number | undefined
      for (const p of t.points) { if (p.date <= date) price = p.price; else break }
      if (price === undefined) { complete = false; break }
      total += t.shares * price
    }
    if (complete) out.push(total)
  }
  const live = [...perTicker.values()].reduce((sum, t) => sum + (Number.isFinite(t.live) ? t.shares * t.live : 0), 0)
  if (out.length > 0 && live > 0) out.push(live)
  return out
}

function moveVisual(slot: PortfolioInsightSlot, assets: any[], history: Map<string, TickerPricePoint[]>, delta: number | undefined, now: Date): PulseVisual | null {
  const windowDays = slot.timeframe === 'daily' ? 7 : slot.windowDays
  const include =
    slot.scope === 'stock' ? (a: any) => a.ticker?.symbol === slot.scopeKey
    : slot.scope === 'sector' ? (a: any) => (a.ticker?.ticker_themes ?? []).some((tt: any) => String(tt?.theme?.name ?? '').trim() === slot.scopeKey)
    : () => true
  const values = seriesForAssets(assets, history, include, windowDays, now)
  if (values.length < MIN_SPARK_POINTS || !values.every(Number.isFinite)) return null
  const dir: 'up' | 'down' = (delta ?? values[values.length - 1] - values[0]) >= 0 ? 'up' : 'down'
  return { kind: 'spark', values, dir }
}

function slotDelta(result: MoversResult, slot: PortfolioInsightSlot): number | undefined {
  if (slot.scope === 'portfolio') return result.dayChangePercent
  if (slot.scope === 'stock') return result.movers.find(m => m.symbol === slot.scopeKey)?.percentChange
  return result.themeMoves.find(t => t.theme === slot.scopeKey)?.avgPercentChange
}

// ── Event visuals ─────────────────────────────────────────────────────────

function symbolOf(event: PulseEvent): string {
  return event.id.split(':')[1] ?? ''
}

function lotsOf(asset: any): any[] {
  return (asset.stock_subtypes ?? []).flatMap((st: any) => st.transactions ?? []).filter((t: any) => netCount(t) > 0)
}

function eventModel(event: PulseEvent, assets: any[], now: Date): Pick<PulseCardModel, 'delta' | 'metric' | 'unit' | 'visual'> {
  const symbol = symbolOf(event)
  try {
    switch (event.kind) {
      case 'long_term': {
        let soonest: number | undefined
        for (const a of assets.filter(x => x.ticker?.symbol === symbol)) {
          for (const lot of lotsOf(a)) {
            if (lot.capital_gains_status !== 'Short Term' || typeof lot.purchase_date !== 'string') continue
            const on = new Date(`${lot.purchase_date.slice(0, 10)}T00:00:00Z`)
            if (Number.isNaN(on.getTime())) continue
            on.setUTCFullYear(on.getUTCFullYear() + 1)
            const d = daysFromToday(on, now)
            if (d >= 0 && (soonest === undefined || d < soonest)) soonest = d
          }
        }
        if (soonest === undefined) return { unit: 'to 1 year', visual: null }
        const held = Math.max(0, Math.min(365, 365 - soonest))
        return {
          metric: countdown(soonest), unit: 'to 1 year',
          visual: { kind: 'progress', pct: (held / 365) * 100, label: `${held} of 365 days held` },
        }
      }
      case 'rsu_vest': {
        const date = event.id.split(':')[2]
        const dates: Date[] = []
        let shares = 0
        let target: Date | null = null
        for (const a of assets.filter(x => x.ticker?.symbol === symbol)) {
          for (const st of a.stock_subtypes ?? []) {
            if (st.subtype !== 'RSU') continue
            for (const g of st.rsu_grants ?? []) {
              if (g.ended_at) continue
              const events = computeRsuVestEvents(g)
              if (events.length === 0) continue
              const hit = events.find(e => e.date.toISOString().split('T')[0] === date)
              if (hit && dates.length === 0) {
                target = hit.date
                dates.push(...events.map(e => e.date))
              }
              if (hit) shares += hit.shares
            }
          }
        }
        if (!target) return { unit: 'upcoming', visual: null }
        const days = daysFromToday(target, now)
        const done = dates.filter(d => d.getTime() < target!.getTime()).length
        const shareText = Number.isInteger(shares) ? shares.toLocaleString('en-US') : shares.toFixed(2)
        return {
          metric: countdown(days), unit: `${shareText} shares`,
          visual: dates.length > 1 ? { kind: 'vest', done, total: dates.length, label: `Installment ${done + 1} of ${dates.length}` } : null,
        }
      }
      case 'harvest': {
        let value = 0
        let cost = 0
        for (const a of assets.filter(x => x.ticker?.symbol === symbol && isTickerAsset(x))) {
          value += computeAssetValue(a)
          cost += lotsOf(a).reduce((s: number, t: any) => s + netCount(t) * Number(t.cost_price), 0)
        }
        if (!(cost > 0)) return { unit: 'vs cost', visual: null }
        const lossPct = ((cost - value) / cost) * 100
        return {
          delta: -lossPct, unit: 'vs cost',
          visual: { kind: 'progress', pct: Math.max(0, Math.min(100, 100 - lossPct)), label: `Worth ${Math.round(100 - lossPct)}% of cost` },
        }
      }
      case 'allocation_drift': {
        const m = /is (\d+)% of your holdings against a (\d+)% target \(([+−-])(\d+) pts\)/.exec(event.text)
        if (!m) return { unit: 'vs target', visual: null }
        const actual = Number(m[1])
        const target = Number(m[2])
        return {
          metric: `${m[3] === '+' ? '+' : '−'}${m[4]} pts`, unit: 'vs target',
          visual: { kind: 'target', actual, target, label: `${actual}% vs ${target}% target` },
        }
      }
      case 'earnings': {
        const date = event.id.split(':')[2]
        const when = new Date(`${date}T00:00:00Z`)
        if (Number.isNaN(when.getTime())) return { unit: 'upcoming', visual: null }
        const days = daysFromToday(when, now)
        return {
          metric: countdown(days), unit: 'to earnings',
          visual: { kind: 'progress', pct: Math.max(0, Math.min(100, ((7 - days) / 7) * 100)), label: `${plural(Math.max(0, days), 'day')} of the 7-day lookahead` },
        }
      }
    }
  } catch {
    // A malformed row just means no visual.
  }
  return { unit: '', visual: null }
}

export function buildCardModel(
  item: PulseItem,
  ctx: { assets: any[]; priceHistory: Map<string, TickerPricePoint[]>; result?: MoversResult; now?: Date },
): PulseCardModel {
  const now = ctx.now ?? new Date()
  if (item.type === 'move') {
    const delta = ctx.result ? slotDelta(ctx.result, item.slot) : undefined
    return {
      key: item.key,
      kind: 'move',
      icon: (delta ?? 0) < 0 ? TrendingDown : TrendingUp,
      text: item.teaser,
      tag: item.tag,
      tagVariant: 'tag',
      timeframe: TIMEFRAME_LABEL[item.slot.timeframe] ?? 'Notable move',
      seen: item.seen,
      delta,
      unit: TIMEFRAME_UNIT[item.slot.timeframe] ?? '',
      visual: moveVisual(item.slot, ctx.assets, ctx.priceHistory, delta, now),
      item,
    }
  }
  return {
    key: item.key,
    kind: item.event.kind,
    icon: EVENT_ICON[item.event.kind] ?? CalendarClock,
    text: item.event.text,
    tag: EVENT_LABEL[item.event.kind] ?? 'Heads up',
    tagVariant: 'outline',
    seen: item.seen,
    ...eventModel(item.event, ctx.assets, now),
    item,
  }
}
