import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { config } from '@/store/config'
import { PositionCard } from '@/components/PositionCard'
import { LayoutGrid, List as ListIcon, RefreshCw } from 'lucide-react'
import { PageBody, PageHead } from '@/components/mne'
import { Dropdown } from '@/components/mne/Dropdown'
import {
  computeAssetValue, computeCostBasis, computeUnrealizedGain, computeShareCount,
  computeFixedIncomeLotCount, isTickerAsset, isTradableFixedIncome,
} from '@/lib/portfolio'
import { refreshPricesOncePerLoad, refreshPricesNow, PRICES_REFRESHED_AT_KEY } from '@/lib/priceRefresh'
import { listPlaidItems, syncPlaidNow } from '@/lib/db/plaid'
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

type SortOption = 'name' | 'qty' | 'value' | 'gain'
type SortDir = 'asc' | 'desc'
type AssetView = 'grid' | 'list'

const key = (k: string, v: string) => (<><span className="pf-dd-k">{k}</span>{v}</>)

/** Quantity held (shares/units); assets without one sort last. */
function quantity(asset: any): number {
  if (isTickerAsset(asset)) return computeShareCount(asset)
  if (isTradableFixedIncome(asset)) return computeFixedIncomeLotCount(asset)
  return -Infinity
}

/** Unrealized gain in dollars; assets without one sort last. */
function gainValue(asset: any): number {
  return isTickerAsset(asset) && computeCostBasis(asset) > 0 ? computeUnrealizedGain(asset) : -Infinity
}

const VIEW_OPTIONS = [
  { value: 'grid' as const, label: <span className="pf-dd-v"><LayoutGrid size={16} strokeWidth={1.5} aria-hidden="true" />Grid</span> },
  { value: 'list' as const, label: <span className="pf-dd-v"><ListIcon size={16} strokeWidth={1.5} aria-hidden="true" />List</span> },
]

function PortfolioSkeleton() {
  return (
    <PageBody>
      <div aria-busy="true" aria-label="Loading" className="contents">
        <div className="mne-page-head"><div className="mne-skel" style={{ height: 40, width: 180 }} /></div>
        <div className="pf-controls">
          <div className="mne-skel is-pill" style={{ height: 44, width: 300 }} />
          <div className="mne-skel is-pill" style={{ height: 44, width: 360 }} />
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
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [refreshing, setRefreshing] = useState(false)
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

  // Refreshes every price and syncs all connected Plaid accounts, then reloads
  // the positions. The two are independent: one failing doesn't block the other.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const plaidSync = listPlaidItems()
        .then((items) => (items.length > 0 ? syncPlaidNow().then(() => undefined) : undefined))
      const [, plaid] = await Promise.allSettled([refreshPricesNow(), plaidSync])
      setPricesRefreshedAt(localStorage.getItem(PRICES_REFRESHED_AT_KEY))
      setAssets(await getAllAssets())
      if (plaid.status === 'rejected') {
        showAppAlert('Prices updated, but syncing your Plaid accounts failed.', { variant: 'error' })
      }
    } catch {
      showAppAlert('Failed to refresh. Please try again.', { variant: 'error' })
    } finally {
      setRefreshing(false)
    }
  }, [])

  const assetTypes = useMemo(() => {
    const types = new Set(assets.map((a) => a.asset_type as string))
    return Array.from(types)
  }, [assets])

  const typeOptions = useMemo(
    () => [{ value: 'All', label: key('Type', 'All') }, ...assetTypes.map((t) => ({ value: t, label: key('Type', t) }))],
    [assetTypes],
  )

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

    const dir = sortDir === 'asc' ? 1 : -1
    result = [...result].sort((a, b) => {
      if (sort === 'name') return dir * (a.name ?? '').localeCompare(b.name ?? '')
      const metric = sort === 'value' ? computeAssetValue : sort === 'qty' ? quantity : gainValue
      const av = metric(a)
      const bv = metric(b)
      // Assets with no figure (-Infinity) stay at the bottom in either direction.
      if (av === bv) return 0
      if (av === -Infinity) return 1
      if (bv === -Infinity) return -1
      return dir * (av - bv)
    })

    return result
  }, [assets, search, activeType, sort, sortDir])

  const handleSort = useCallback((next: SortOption) => {
    if (next === sort) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(next)
      setSortDir(next === 'name' ? 'asc' : 'desc')
    }
  }, [sort])

  const sortHeader = (col: SortOption, label: string, className?: string) => (
    <th className={className} aria-sort={sort === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="pf-sort" onClick={() => handleSort(col)}>
        {label}
        <span className="pf-sort-ind" aria-hidden="true">{sort === col ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

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
      <PageBody>
        <PageHead title="Portfolio">
          {updated && <span className="mne-live max-sm:!hidden"><i aria-hidden="true" />Prices {updated}</span>}
          <button
            type="button"
            className="pf-iconbtn"
            aria-label="Refresh prices and sync accounts"
            title="Refresh prices and sync accounts"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <RefreshCw size={16} strokeWidth={1.5} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </PageHead>

        <div className="pf-toolbar">
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
          <Dropdown<AssetView> label="Asset view" value={assetView} options={VIEW_OPTIONS} onChange={handleAssetViewChange} />
          <Dropdown<string> label="Filter by type" value={activeType} options={typeOptions} onChange={setActiveType} alignRight />
        </div>

        {isListView ? (
          displayed.length > 0 && (
            <section className="mne-card pf-scroll">
              <table className="mne-table">
                <thead>
                  <tr>
                    {sortHeader('name', 'Position')}
                    {sortHeader('qty', 'Qty', 'r pf-hide-sm')}
                    {sortHeader('value', 'Value', 'r')}
                    {sortHeader('gain', 'Gain', 'r pf-hide-sm')}
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
