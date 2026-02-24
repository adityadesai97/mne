import type { getAllAssets } from './db/assets'

export type Asset = Awaited<ReturnType<typeof getAllAssets>>[number]

type Transaction = { count: number | string; cost_price: number | string }
type StockSubtype = { transactions: Transaction[] | null; rsu_grants: unknown[] | null }
type Ticker = { current_price: number | null }

export type AssetTyped = {
  asset_type: string
  price: number | null
  initial_price?: number | null
  ticker: Ticker | null
  stock_subtypes: StockSubtype[] | null
}

export function computeAssetValue(asset: AssetTyped): number {
  if (asset.asset_type !== 'Stock') return asset.price ?? 0
  if (asset.ticker?.current_price == null) return 0
  const price = asset.ticker.current_price
  const shares = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + Number(t.count), 0) ?? 0
  return Math.round(price * shares * 100) / 100
}

export function computeCostBasis(asset: AssetTyped): number {
  const raw = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + Number(t.count) * Number(t.cost_price), 0) ?? 0
  return Math.round(raw * 100) / 100
}

export function computeUnrealizedGain(asset: AssetTyped): number {
  return computeAssetValue(asset) - computeCostBasis(asset)
}

export function computeTotalNetWorth(assets: AssetTyped[]): number {
  return assets.reduce((sum, a) => sum + computeAssetValue(a), 0)
}

export function computeCashGain(asset: AssetTyped): number {
  if (asset.asset_type === 'Stock' || asset.initial_price == null) return 0
  return (asset.price ?? 0) - asset.initial_price
}

export function computeCashGainPct(asset: AssetTyped): number {
  if (asset.asset_type === 'Stock' || !asset.initial_price) return 0
  return (computeCashGain(asset) / asset.initial_price) * 100
}
