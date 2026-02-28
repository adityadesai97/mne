// src/pages/Portfolio.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { PositionCard } from '@/components/PositionCard'
import { computeAssetValue, computeUnrealizedGain } from '@/lib/portfolio'

type SortOption = 'name' | 'value' | 'gain'

export default function Portfolio() {
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [activeType, setActiveType] = useState<string>('All')
  const [sort, setSort] = useState<SortOption>('name')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  useEffect(() => {
    getAllAssets()
      .then(setAssets)
      .catch(console.error)
      .finally(() => setAssetsLoaded(true))
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (config.finnhubApiKey) await refreshAllPrices(config.finnhubApiKey).catch(console.error)
    const fresh = await getAllAssets().catch(() => assets)
    setAssets((fresh as any[]) ?? assets)
  }, [assets])

  const { refreshing, pullY } = usePullToRefresh(handleRefresh, isMobile)

  const assetTypes = useMemo(() => {
    const types = new Set(assets.map((a) => a.asset_type as string))
    return Array.from(types)
  }, [assets])

  const chips = ['All', ...assetTypes]

  const displayed = useMemo(() => {
    let result = assets

    if (search.trim()) {
      const query = search.trim().toLowerCase()
      result = result.filter((a) => a.name?.toLowerCase().includes(query))
    }

    if (activeType !== 'All') {
      result = result.filter((a) => a.asset_type === activeType)
    }

    result = [...result].sort((a, b) => {
      if (sort === 'name') {
        return (a.name ?? '').localeCompare(b.name ?? '')
      }
      if (sort === 'value') {
        return computeAssetValue(b) - computeAssetValue(a)
      }
      if (sort === 'gain') {
        return computeUnrealizedGain(b) - computeUnrealizedGain(a)
      }
      return 0
    })

    return result
  }, [assets, search, activeType, sort])

  if (!assetsLoaded) {
    return (
      <div className="pt-6 pb-4 px-4">
        <h1 className="text-xl font-bold">Portfolio</h1>
        <p className="mt-4 text-sm text-muted-foreground">Loading portfolio...</p>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="pt-6 pb-4 px-4">
        <h1 className="text-xl font-bold">Portfolio</h1>
        <div className="mt-4 rounded-2xl border border-border bg-card p-6">
          <p className="font-syne text-2xl font-bold tracking-tight text-foreground">Add an asset first.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Portfolio data appears after your first asset is added.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="pt-6 pb-4">
      <div className="flex justify-between items-center px-4 mb-3">
        <h1 className="text-xl font-bold">Portfolio</h1>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="bg-card border border-border rounded text-xs px-2 py-1 text-muted-foreground"
        >
          <option value="name">Name (A–Z)</option>
          <option value="value">Value ↓</option>
          <option value="gain">Gain/Loss ↓</option>
        </select>
      </div>

      <div className="px-4 mb-3">
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-muted rounded-lg px-3 py-2 text-sm w-full border-0 focus:outline-none"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 mb-3 pb-1 no-scrollbar">
        {chips.map((type) => {
          const isActive = activeType === type
          return (
            <button
              key={type}
              onClick={() => setActiveType(type)}
              className={`text-xs px-3 py-1 rounded-full border shrink-0 ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border'
              }`}
            >
              {type}
            </button>
          )
        })}
      </div>

      {displayed.map((a) => (
        <PositionCard key={a.id} asset={a} />
      ))}

      {assets.length > 0 && displayed.length === 0 && (
        <p className="text-muted-foreground text-center mt-16">
          No results match your search.
        </p>
      )}
    </div>
    </>
  )
}
