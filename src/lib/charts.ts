import { computeAssetValue, computeCostBasis, computeUnrealizedGain, netCount } from './portfolio'
import { formatDateMDY } from './dates'

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
  if (asset.asset_type !== 'Stock') return asset.price ?? 0
  const lots = (asset.stock_subtypes ?? [])
    .filter((st: any) => activeSubtypes.has(st.subtype))
    .flatMap((st: any) => st.transactions ?? [])
  const price = asset.ticker?.current_price
  if (!price) {
    // No live price yet — show cost basis so stocks still appear in charts
    return lots.reduce((sum: number, t: any) => sum + netCount(t) * Number(t.cost_price), 0)
  }
  const shares = lots.reduce((sum: number, t: any) => sum + netCount(t), 0)
  return Math.round(price * shares * 100) / 100
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
    .filter(a => a.asset_type === 'Stock')
    .map(a => ({ name: a.name, gain: computeUnrealizedGain(a) }))
    .filter(p => p.gain !== 0)
    .sort((a, b) => b.gain - a.gain)
}

// ── Capital Gains Exposure ────────────────────────────────────

export function computeCapitalGainsExposure(assets: any[]) {
  let shortTerm = 0
  let longTerm = 0
  for (const a of assets) {
    if (a.asset_type !== 'Stock') continue
    const price = a.ticker?.current_price ?? 0
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
    .filter(a => a.asset_type === 'Stock' && computeCostBasis(a) > 0)
    .map(a => ({
      name: a.name,
      costBasis: computeCostBasis(a),
      currentValue: computeAssetValue(a),
    }))
}

// ── RSU Vesting Progress ──────────────────────────────────────
//
// A grant vests either as discrete installments (the real-world shape —
// a lump at the cliff, then equal chunks every month/quarter/year through
// vest_end) or, for a grant nobody's told the app the cadence of, as a
// smooth continuous accrual across [vest_start, vest_end]. This is the one
// place that math lives; the RSU progress chart, the command bar's
// vesting-schedule tool, and the vest-alert edge function (which ports a
// copy, since it can't import from src/) all key off it.

export type RsuVestingFrequency = 'monthly' | 'quarterly' | 'annually' | 'continuous'

const RSU_VESTING_FREQUENCY_MONTHS: Record<Exclude<RsuVestingFrequency, 'continuous'>, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
}

function normalizeRsuVestingFrequency(value: unknown): RsuVestingFrequency {
  return value === 'monthly' || value === 'quarterly' || value === 'annually' || value === 'continuous'
    ? value
    : 'quarterly'
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

export type RsuVestEvent = { date: Date; shares: number }

// Builds the discrete vest-event list for a grant: a lump at the cliff
// (grant.cliff_date, or grant.vest_start when no separate cliff was
// recorded) covering however many periods elapsed since grant_date, then
// one event every `periodMonths` after that through vest_end. The cliff
// absorbs the rounding remainder so events sum to exactly total_shares —
// standard equity-administration practice, and what reproduces real vest
// amounts (verified against an actual brokerage statement) rather than
// naively splitting total_shares evenly across every period including
// the cliff.
export function computeRsuVestEvents(grant: any): RsuVestEvent[] {
  const frequency = normalizeRsuVestingFrequency(grant?.vesting_frequency)
  if (frequency === 'continuous') return []
  const periodMonths = RSU_VESTING_FREQUENCY_MONTHS[frequency]
  const grantDate = new Date(grant.grant_date)
  const vestEnd = new Date(grant.vest_end)
  const firstVestDate = new Date(grant.cliff_date ?? grant.vest_start)
  const total = Number(grant.total_shares)
  if (!(total > 0) || !(vestEnd > grantDate) || !(firstVestDate <= vestEnd)) return []

  let totalPeriods = 0
  let cursor = new Date(grantDate)
  while (cursor < vestEnd) {
    cursor = addMonths(cursor, periodMonths)
    totalPeriods += 1
  }
  if (totalPeriods <= 0) return []

  let periodsAtCliff = 0
  cursor = new Date(grantDate)
  while (cursor < firstVestDate) {
    cursor = addMonths(cursor, periodMonths)
    periodsAtCliff += 1
  }

  const remainingPeriods = totalPeriods - periodsAtCliff
  const perPeriodShares = Math.round(total / totalPeriods)
  const cliffShares = total - perPeriodShares * remainingPeriods

  const events: RsuVestEvent[] = [{ date: firstVestDate, shares: Math.max(0, cliffShares) }]
  cursor = new Date(firstVestDate)
  for (let i = 0; i < remainingPeriods; i += 1) {
    cursor = addMonths(cursor, periodMonths)
    events.push({ date: cursor, shares: perPeriodShares })
  }
  return events
}

// Shares vested as of a given date — the one primitive every vesting
// question (progress chart, "how many vest next month", alert thresholds)
// reduces to.
export function rsuVestedSharesAsOf(grant: any, asOf: Date): number {
  const total = Number(grant?.total_shares) || 0
  const endedAt = grant?.ended_at ? new Date(grant.ended_at) : null
  const effective = endedAt && endedAt < asOf ? endedAt : asOf

  const frequency = normalizeRsuVestingFrequency(grant?.vesting_frequency)
  if (frequency === 'continuous') {
    const vestStart = new Date(grant.vest_start)
    const vestEnd = new Date(grant.vest_end)
    const cliffDate = grant.cliff_date ? new Date(grant.cliff_date) : null
    if (effective >= vestEnd) return total
    if (effective >= vestStart && (!cliffDate || effective >= cliffDate)) {
      const elapsed = effective.getTime() - vestStart.getTime()
      const duration = vestEnd.getTime() - vestStart.getTime()
      return duration > 0 ? Math.floor((elapsed / duration) * total) : total
    }
    return 0
  }

  let vested = 0
  for (const event of computeRsuVestEvents(grant)) {
    if (event.date <= effective) vested += event.shares
  }
  return Math.min(vested, total)
}

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
    if (asset.asset_type === 'Stock') {
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
