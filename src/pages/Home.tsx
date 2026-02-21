// src/pages/Home.tsx
import { useEffect, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { computeAssetValue, computeCostBasis, computeTotalNetWorth } from '@/lib/portfolio'
import { NetWorthCard } from '@/components/NetWorthCard'
import { AssetTypeBreakdown } from '@/components/AssetTypeBreakdown'

export default function Home() {
  const [assets, setAssets] = useState<any[]>([])

  useEffect(() => {
    getAllAssets().then(setAssets).catch(console.error)
  }, [])

  const totalValue = computeTotalNetWorth(assets)
  const totalCost = assets.reduce((sum, a) => sum + computeCostBasis(a), 0)
  const gainLoss = totalValue - totalCost
  const gainLossPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0

  const groups = groupByAssetType(assets)

  return (
    <div className="relative">
      <NetWorthCard value={totalValue} gainLoss={gainLoss} gainLossPercent={gainLossPercent} />
      <AssetTypeBreakdown groups={groups} totalValue={totalValue} />
    </div>
  )
}

function groupByAssetType(assets: any[]) {
  const map: Record<string, { value: number; count: number }> = {}
  for (const a of assets) {
    const val = computeAssetValue(a)
    if (!map[a.asset_type]) map[a.asset_type] = { value: 0, count: 0 }
    map[a.asset_type].value += val
    map[a.asset_type].count += 1
  }
  return Object.entries(map).map(([type, { value, count }]) => ({ type, value, count }))
}
