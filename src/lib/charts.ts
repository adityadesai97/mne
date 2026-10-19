import { computeAssetValue, computeCostBasis, computeUnrealizedGain, isTickerAsset, netCount, getLivePrice, computeSubtypeValue } from './portfolio'
import { formatDateMDY } from './dates'
import { computeRsuVestEvents, rsuVestedSharesAsOf, normalizeRsuVestingFrequency } from './vesting'
import type { RsuVestingFrequency } from './vesting'

// ── Portfolio Allocation ──────────────────────────────────────

export function groupByAssetType(assets: any[], activeSubtypes: Set<string>) {
  const map: Record<string, number> = {}
  for (const a of assets) {
    const val = filteredStockValue(a, activeSubtypes)
    map[a.asset_type] = (map[a.asset_type] ?? 0) + val
  }
  return Object.entries(map)
    .map(([type, value]) => ({ type, value }))
    .filter(g => g.value > 0)
}

function filteredStockValue(asset: any, activeSubtypes: Set<string>): number {
  // Everything that isn't a ticker position (cash, 401k, HSA, CD/Deposit, and
  // lot-based Bond/T-Bill) uses the same valuation as net worth, so the
  // allocation total reconciles with it.
  if (!isTickerAsset(asset)) return computeAssetValue(asset)
  // No live price → net worth counts the position as 0, so the chart does too.
  return computeSubtypeValue(asset, activeSubtypes)
}

// ── By Location ───────────────────────────────────────────────

export function groupByLocation(assets: any[]) {
  const map: Record<string, number> = {}
  for (const a of assets) {
    const name = a.location?.name ?? 'Unknown'
    map[name] = (map[name] ?? 0) + computeAssetValue(a)
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter(g => g.value > 0)
}

// ── Unrealized P&L by Position ────────────────────────────────

export function computeUnrealizedPnLByPosition(assets: any[]) {
  return assets
    .filter(a => isTickerAsset(a))
    .map(a => ({ name: a.name, gain: computeUnrealizedGain(a) }))
    .filter(p => p.gain !== 0)
    .sort((a, b) => b.gain - a.gain)
}

// ── Capital Gains Exposure ────────────────────────────────────

// Distinct ticker symbols that have lots counted in the exposure chart, sorted.
export function listCapitalGainsSymbols(assets: any[]): string[] {
  const symbols = new Set<string>()
  for (const a of assets) {
    if (isTickerAsset(a) && a.ticker?.symbol) symbols.add(a.ticker.symbol)
  }
  return [...symbols].sort()
}

// `symbol` narrows the totals to one ticker (across all accounts); omit for everything.
export function computeCapitalGainsExposure(assets: any[], symbol?: string) {
  let shortTerm = 0
  let longTerm = 0
  for (const a of assets) {
    if (!isTickerAsset(a)) continue
    if (symbol && a.ticker?.symbol !== symbol) continue
    // No live price → no meaningful gain (treating it as $0 would report the
    // whole cost basis as a loss).
    const price = getLivePrice(a)
    if (price == null) continue
    for (const st of a.stock_subtypes ?? []) {
      for (const t of st.transactions ?? []) {
        const gain = netCount(t) * (price - Number(t.cost_price))
        if (t.capital_gains_status === 'Short Term') shortTerm += gain
        // Transactions with any status other than 'Short Term' (including Long Term) count as long-term
        else longTerm += gain
      }
    }
  }
  return { shortTerm, longTerm }
}

// ── Cost Basis vs Current Value ───────────────────────────────

export function computeCostVsValue(assets: any[]) {
  return assets
    .filter(a => isTickerAsset(a) && computeCostBasis(a) > 0)
    .map(a => ({
      name: a.name,
      costBasis: computeCostBasis(a),
      currentValue: computeAssetValue(a),
    }))
}

// Vesting math moved to ./vesting (shared with ESOP option grants).
export {
  computeRsuVestEvents,
  rsuVestedSharesAsOf,
  normalizeRsuVestingFrequency,
} from './vesting'
export type { RsuVestingFrequency, RsuVestEvent } from './vesting'

export type RsuVestRow = {
  label: string
  vestedShares: number
  unvestedShares: number
  totalShares: number
}

export function computeRsuVesting(assets: any[], today: Date = new Date()): RsuVestRow[] {
  // Each row carries its grant's vest_end alongside the public RsuVestRow
  // fields so rows can be sorted chronologically (soonest to fully vest
  // first — the same date the vest-alert edge function keys off of)
  // before that sort key is stripped back off below.
  const rows: (RsuVestRow & { vestEndTime: number })[] = []
  for (const a of assets) {
    for (const st of a.stock_subtypes ?? []) {
      if (st.subtype !== 'RSU') continue
      for (const grant of st.rsu_grants ?? []) {
        const vestEnd = new Date(grant.vest_end)
        const total = Number(grant.total_shares)
        const endedAt = grant.ended_at ? new Date(grant.ended_at) : null
        const vested = rsuVestedSharesAsOf(grant, today)
        const label = `${a.ticker?.symbol ?? a.name} · ${formatDateMDY(grant.grant_date)}${endedAt ? ' (Ended)' : ''}`

        rows.push({
          label,
          vestedShares: vested,
          unvestedShares: endedAt ? 0 : total - vested,
          totalShares: total,
          vestEndTime: vestEnd.getTime(),
        })
      }
    }
  }
  rows.sort((a, b) => a.vestEndTime - b.vestEndTime)
  return rows.map(({ vestEndTime, ...row }) => row)
}

// ── Stock Distribution by Theme ───────────────────────────────

export function computeThemeDistribution(assets: any[], includeCash = false) {
  const map: Record<string, number> = {}

  for (const asset of assets) {
    if (isTickerAsset(asset)) {
      const value = computeAssetValue(asset)
      if (value <= 0) continue

      const rawNames = (asset.ticker?.ticker_themes ?? [])
        .map((tt: any) => String(tt?.theme?.name ?? '').trim())
        .filter((name: string) => name.length > 0)
      const names = Array.from(new Set<string>(rawNames))

      const bucketNames = names.length > 0 ? names : ['Uncategorized']
      const share = value / bucketNames.length
      for (const name of bucketNames) {
        map[name] = (map[name] ?? 0) + share
      }
      continue
    }

    if (includeCash && asset.asset_type === 'Cash') {
      const cashValue = Number(asset.price ?? 0)
      if (cashValue > 0) map.Cash = (map.Cash ?? 0) + cashValue
    }
  }

  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
}

// ── RSU vesting timeline (rail chart) ─────────────────────────
//
// Same grants and ordering as computeRsuVesting, plus the dates the rail
// chart needs: the grant's span, its cliff, each discrete vest event and the
// next one still to come. Reuses computeRsuVestEvents / rsuVestedSharesAsOf,
// so the numbers can never disagree with the bar rows.

export type RsuTimelineEvent = { ms: number; shares: number; done: boolean }
export type RsuTimelineRow = {
  label: string
  vestedShares: number
  totalShares: number
  ended: boolean
  startMs: number
  endMs: number
  todayMs: number
  /** Cliff (or first vest) date, when the grant has one. */
  cliffMs: number | null
  /** Discrete installments; empty for a continuously vesting grant. */
  events: RsuTimelineEvent[]
  nextVest: { ms: number; shares: number } | null
  /** Ticker (or asset name) alone, without the grant date that `label` carries. */
  symbol: string
  /** Grant date; the left edge of the rail. */
  grantMs: number
  frequency: RsuVestingFrequency
  /** True when the grant records a cliff date of its own. */
  hasCliff: boolean
  /** Date the grant was ended (cancelled), if it was. */
  endedMs: number | null
  /** Unvested shares given up when the grant ended; 0 for a live grant. */
  forfeitedShares: number
}

export function computeRsuVestTimeline(assets: any[], today: Date = new Date()): RsuTimelineRow[] {
  const rows: RsuTimelineRow[] = []
  for (const a of assets) {
    for (const st of a.stock_subtypes ?? []) {
      if (st.subtype !== 'RSU') continue
      for (const grant of st.rsu_grants ?? []) {
        const total = Number(grant.total_shares)
        const endedAt = grant.ended_at ? new Date(grant.ended_at) : null
        const startMs = new Date(grant.grant_date ?? grant.vest_start).getTime()
        const endMs = new Date(grant.vest_end).getTime()
        const events = computeRsuVestEvents(grant).map(e => ({
          ms: e.date.getTime(),
          shares: e.shares,
          done: e.date <= (endedAt && endedAt < today ? endedAt : today),
        }))
        const cliffSource = grant.cliff_date ?? (events.length > 0 ? grant.vest_start : null)
        const cliffMs = cliffSource ? new Date(cliffSource).getTime() : null
        const next = endedAt ? undefined : events.find(e => !e.done)
        const vestedShares = rsuVestedSharesAsOf(grant, today)
        const endedMs = endedAt ? endedAt.getTime() : null
        rows.push({
          symbol: String(a.ticker?.symbol ?? a.name),
          grantMs: Number.isFinite(startMs) ? startMs : endMs,
          frequency: normalizeRsuVestingFrequency(grant.vesting_frequency),
          hasCliff: !!grant.cliff_date,
          endedMs: endedMs !== null && Number.isFinite(endedMs) ? endedMs : null,
          forfeitedShares: endedAt ? Math.max(0, total - vestedShares) : 0,
          label: `${a.ticker?.symbol ?? a.name} · ${formatDateMDY(grant.grant_date)}${endedAt ? ' (Ended)' : ''}`,
          vestedShares,
          totalShares: total,
          ended: !!endedAt,
          startMs: Number.isFinite(startMs) ? startMs : endMs,
          endMs,
          todayMs: (endedAt && endedAt < today ? endedAt : today).getTime(),
          cliffMs: cliffMs !== null && Number.isFinite(cliffMs) ? cliffMs : null,
          events,
          nextVest: next ? { ms: next.ms, shares: next.shares } : null,
        })
      }
    }
  }
  rows.sort((a, b) => a.endMs - b.endMs)
  return rows
}
