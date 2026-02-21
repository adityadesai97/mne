// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssetRow = any

export function computeAssetValue(asset: AssetRow): number {
  if (asset.asset_type !== 'Stock') return asset.price ?? 0
  if (!asset.ticker?.current_price) return 0
  const price = asset.ticker.current_price
  const shares = asset.stock_subtypes?.flatMap((st: AssetRow) => st.transactions ?? [])
    .reduce((sum: number, t: AssetRow) => sum + Number(t.count), 0) ?? 0
  return price * shares
}

export function computeCostBasis(asset: AssetRow): number {
  return asset.stock_subtypes?.flatMap((st: AssetRow) => st.transactions ?? [])
    .reduce((sum: number, t: AssetRow) => sum + Number(t.count) * Number(t.cost_price), 0) ?? 0
}

export function computeUnrealizedGain(asset: AssetRow): number {
  return computeAssetValue(asset) - computeCostBasis(asset)
}

export function computeTotalNetWorth(assets: AssetRow[]): number {
  return assets.reduce((sum: number, a: AssetRow) => sum + computeAssetValue(a), 0)
}
