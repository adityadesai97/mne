import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { PositionCard } from '@/components/PositionCard'
import { PageBody, PageHead, SegmentedControl } from '@/components/mne'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain } from '@/lib/portfolio'
import { refreshPricesOncePerLoad, PRICES_REFRESHED_AT_KEY } from '@/lib/priceRefresh'
import { showAppAlert } from '@/lib/appAlerts'
import '@/styles/portfolio.css'

function formatRelativeTime(isoString: string | null): string | null {
  if (!isoString) return null
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type SortOption = 'name' | 'value' | 'gain' | 'gainPct'
type AssetView = 'grid' | 'list'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'value', label: 'Value' },
  { value: 'gain', label: 'Gain $' },
  { value: 'gainPct', label: 'Gain %' },
]

const VIEW_OPTIONS: { value: AssetView; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
]

/** Unrealized gain as a percent of cost basis; assets with no basis sort last. */
function gainPct(asset: any): number {
  const basis = computeCostBasis(asset)
  if (basis <= 0) return -Infinity
  return (computeUnrealizedGain(asset) / basis) * 100
}

function PortfolioSkeleton() {
  return (
    <PageBody>
      <div aria-busy="true" aria-label="Loading" className="contents">
        <div className="mne-page-head"><div className="mne-skel" style={{ height: 40, width: 180 }} /></div>
        <div className="pf-controls">
          <div className="mne-skel is-pill" style={{ height: 44, width: 300 }} />
          <div className="mne-skel is-pill" style={{ height: 36, width: 120 }} />
        </div>
        <div className="pf-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mne-card" style={{ display: 'grid', gap: 12 }}>
              <div className="mne-skel is-pill" style={{ height: 14, width: '50%' }} />
              <div className="mne-skel" style={{ height: 40, width: '70%' }} />
              <div className="mne-skel is-pill" style={{ height: 12, width: '40%' }} />
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  )
}

export default function Portfolio() {
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [activeType, setActiveType] = useState<string>('All')
  const [sort, setSort] = useState<SortOption>('name')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [pricesRefreshedAt, setPricesRefreshedAt] = useState<string | null>(
    () => localStorage.getItem(PRICES_REFRESHED_AT_KEY)
  )
  // Read once at mount for the initial render (Portfolio remounts on route
  // navigation, so this always reflects the last persisted choice); changes
  // via the dropdown below both update this state and persist to localStorage.
  // Until the user explicitly picks a view, default to list on mobile and
  // grid on desktop.
  const [assetView, setAssetView] = useState<AssetView>(
    () => config.assetView ?? (window.innerWidth < 768 ? 'list' : 'grid')
  )
  const isListView = assetView === 'list'

  const handleAssetViewChange = useCallback((v: AssetView) => {
    config.setAssetView(v)
    setAssetView(v)
  }, [])

  useEffect(() => {
    // Awaiting the (deduped, best-effort) price refresh first means a fresh
    // page load renders with current prices instead of whatever was cached
    // from the last visit — see src/lib/priceRefresh.ts.
    refreshPricesOncePerLoad().finally(() => {
      getAllAssets()
        .then(setAssets)
        .catch(() => showAppAlert('Failed to load portfolio data. Please refresh.', { variant: 'error' }))
        .finally(() => setAssetsLoaded(true))
    })
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (config.hasFinnhubKey) {
      try {
        await refreshAllPrices()
        const now = new Date().toISOString()
        localStorage.setItem(PRICES_REFRESHED_AT_KEY, now)
        setPricesRefreshedAt(now)
      } catch {
        showAppAlert('Price refresh failed. Check your Finnhub API key.', { variant: 'error' })
      }
    }
    const fresh = await getAllAssets().catch(() => {
      showAppAlert('Failed to reload portfolio.', { variant: 'error' })
      return assets
    })
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
      const tokens = search.trim().toLowerCase().split(/\s+/)
      result = result.filter((a) => {
        const haystack = [a.name, a.location?.name, a.location?.account_type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return tokens.every((token) => haystack.includes(token))
      })
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
      if (sort === 'gainPct') {
        return gainPct(b) - gainPct(a)
      }
      return 0
    })

    return result
  }, [assets, search, activeType, sort])

  if (!assetsLoaded) {
    return <PortfolioSkeleton />
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <PageBody>
        <PageHead title="Portfolio" />
        <section className="mne-card">
          <div className="mne-empty">
            <span className="ico">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2" /></svg>
            </span>
            <h3>Add an asset first.</h3>
            <p>Portfolio data appears after your first asset is added.</p>
          </div>
        </section>
      </PageBody>
    )
  }

  const updated = formatRelativeTime(pricesRefreshedAt)

  return (
    <>
      <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
      <PageBody>
        <PageHead title="Portfolio">
          {updated && <span className="mne-live"><i aria-hidden="true" />Prices {updated}</span>}
        </PageHead>

        <div className="pf-controls">
          <div className={`mne-search pf-search${search ? ' has-value' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input
              className="mne-input"
              aria-label="Search positions"
              placeholder="Search positions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="clear" aria-label="Clear search" tabIndex={search ? 0 : -1} onClick={() => setSearch('')}>✕</button>
          </div>
          <SegmentedControl<AssetView> value={assetView} options={VIEW_OPTIONS} onChange={handleAssetViewChange} label="Asset view" />
        </div>

        <div className="pf-controls">
          <div className="pf-filters" role="group" aria-label="Filter by type">
            {chips.map((type) => (
              <button
                key={type}
                type="button"
                className={`mne-chip ${activeType === type ? 'is-accent' : 'is-outline'}`}
                aria-pressed={activeType === type}
                onClick={() => setActiveType(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <SegmentedControl<SortOption> value={sort} options={SORT_OPTIONS} onChange={setSort} label="Sort by" />
        </div>

        {isListView ? (
          displayed.length > 0 && (
            <section className="mne-card pf-scroll">
              <table className="mne-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="r pf-hide-sm">Qty</th>
                    <th className="r">Value</th>
                    <th className="r pf-hide-sm">Gain</th>
                    <th className="r">Today</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((a, i) => (
                    <PositionCard key={a.id} asset={a} index={i} layout="list" />
                  ))}
                </tbody>
              </table>
            </section>
          )
        ) : (
          <div className="pf-grid">
            {displayed.map((a, i) => (
              <PositionCard key={a.id} asset={a} index={i} />
            ))}
          </div>
        )}

        {displayed.length === 0 && (
          <section className="mne-card">
            <div className="mne-empty">
              <span className="ico">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              </span>
              <h3>No results</h3>
              <p>No results match your search.</p>
            </div>
          </section>
        )}
      </PageBody>
    </>
  )
}
