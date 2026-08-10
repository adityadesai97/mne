import type { getAllAssets } from './db/assets'

export type Asset = Awaited<ReturnType<typeof getAllAssets>>[number]

type Transaction = { count: number | string; cost_price: number | string; sold_at_vest?: number | string | null }
type StockSubtype = { transactions: Transaction[] | null; rsu_grants: unknown[] | null }

export function netCount(t: Transaction): number {
  return Math.max(0, Number(t.count) - Number(t.sold_at_vest ?? 0))
}
type Ticker = { current_price: number | null; previous_close?: number | null }

export type AssetTyped = {
  asset_type: string
  price: number | null
  ticker: Ticker | null
  stock_subtypes: StockSubtype[] | null
}

export function computeAssetValue(asset: AssetTyped): number {
  if (asset.asset_type !== 'Stock') return asset.price ?? 0
  if (asset.ticker?.current_price == null) return 0
  const price = asset.ticker.current_price
  const shares = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + netCount(t), 0) ?? 0
  return Math.round(price * shares * 100) / 100
}

export function computeCostBasis(asset: AssetTyped): number {
  const raw = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + netCount(t) * Number(t.cost_price), 0) ?? 0
  return Math.round(raw * 100) / 100
}

export function computeShareCount(asset: AssetTyped): number {
  return asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + netCount(t), 0) ?? 0
}

// P&L is a stock-only concept — non-stock assets (Cash, 401k, CD, HSA, Deposit, etc.)
// have no cost basis and must never contribute a gain/loss figure.
export function computeUnrealizedGain(asset: AssetTyped): number {
  if (asset.asset_type !== 'Stock') return 0
  return computeAssetValue(asset) - computeCostBasis(asset)
}

export function computeTotalNetWorth(assets: AssetTyped[]): number {
  return assets.reduce((sum, a) => sum + computeAssetValue(a), 0)
}

export type DailyChange = { dollarChange: number; percentChange: number }

// Today's move for a single stock position, derived from the ticker's last
// refreshed quote (current_price vs previous_close) rather than the net
// worth snapshot series — this reflects live prices even before today's
// snapshot has been recorded. Returns null when there isn't enough data to
// compute a change (non-stock asset, no shares held, or previous_close not
// yet populated by a price refresh).
export function computeDailyChange(asset: AssetTyped): DailyChange | null {
  if (asset.asset_type !== 'Stock') return null
  const currentPrice = asset.ticker?.current_price
  const previousClose = asset.ticker?.previous_close
  if (currentPrice == null || previousClose == null || previousClose === 0) return null
  const shares = computeShareCount(asset)
  if (shares <= 0) return null
  const priceDelta = currentPrice - previousClose
  return {
    dollarChange: Math.round(priceDelta * shares * 100) / 100,
    percentChange: (priceDelta / previousClose) * 100,
  }
}
