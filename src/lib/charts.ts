import { computeAssetValue, computeCostBasis, computeUnrealizedGain } from './portfolio'

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
  if (!asset.ticker?.current_price) return 0
  const price = asset.ticker.current_price
  const shares = (asset.stock_subtypes ?? [])
    .filter((st: any) => activeSubtypes.has(st.subtype))
    .flatMap((st: any) => st.transactions ?? [])
    .reduce((sum: number, t: any) => sum + Number(t.count), 0)
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
    const price = a.ticker?.current_price ?? 0
    for (const st of a.stock_subtypes ?? []) {
      for (const t of st.transactions ?? []) {
        const gain = Number(t.count) * (price - Number(t.cost_price))
        if (t.capital_gains_status === 'Short Term') shortTerm += gain
        else longTerm += gain
      }
    }
  }
  return { shortTerm, longTerm }
}

// ── Cost Basis vs Current Value ───────────────────────────────

export function computeCostVsValue(assets: any[]) {
  return assets
    .filter(a => a.asset_type === 'Stock' && computeAssetValue(a) > 0)
    .map(a => ({
      name: a.name,
      costBasis: computeCostBasis(a),
      currentValue: computeAssetValue(a),
    }))
}

// ── RSU Vesting Progress ──────────────────────────────────────

export type RsuVestRow = {
  label: string
  vestedShares: number
  unvestedShares: number
  totalShares: number
}

export function computeRsuVesting(assets: any[], today: Date = new Date()): RsuVestRow[] {
  const rows: RsuVestRow[] = []
  for (const a of assets) {
    for (const st of a.stock_subtypes ?? []) {
      if (st.subtype !== 'RSU') continue
      for (const grant of st.rsu_grants ?? []) {
        const vestStart = new Date(grant.vest_start)
        const vestEnd = new Date(grant.vest_end)
        const cliffDate = grant.cliff_date ? new Date(grant.cliff_date) : null
        const total = Number(grant.total_shares)

        let vested = 0
        if (today >= vestEnd) {
          vested = total
        } else if (today >= vestStart && (!cliffDate || today >= cliffDate)) {
          const elapsed = today.getTime() - vestStart.getTime()
          const duration = vestEnd.getTime() - vestStart.getTime()
          vested = Math.floor((elapsed / duration) * total)
        }

        rows.push({
          label: `${a.ticker?.symbol ?? a.name} · ${grant.grant_date}`,
          vestedShares: vested,
          unvestedShares: total - vested,
          totalShares: total,
        })
      }
    }
  }
  return rows
}
