// src/pages/Portfolio.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { Search, X, ArrowDownAZ, ArrowDownWideNarrow, TrendingUpDown, PackageOpen, SearchX, ChevronDown } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { PositionCard } from '@/components/PositionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { computeAssetValue, computeUnrealizedGain } from '@/lib/portfolio'
import { refreshPricesOncePerLoad, PRICES_REFRESHED_AT_KEY } from '@/lib/priceRefresh'
import { showAppAlert } from '@/lib/appAlerts'

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

type SortOption = 'name' | 'value' | 'gain'

const SORT_OPTIONS: { v: SortOption; label: string; icon: React.ElementType }[] = [
  { v: 'name', label: 'Name', icon: ArrowDownAZ },
  { v: 'value', label: 'Value', icon: ArrowDownWideNarrow },
  { v: 'gain', label: 'Gain', icon: TrendingUpDown },
]

/**
 * Dropdown for the sort control — a single button showing the current
 * selection (icon + label) that opens a small menu of the other options.
 * Kept generic (rather than inlined into the sort control specifically)
 * since it started life shared with a since-removed layout picker and may
 * end up backing another option control again.
 */
function OptionDropdown<T extends string>({
  value, options, onChange, ariaLabel,
}: {
  value: T
  options: { v: T; label: string; icon: React.ElementType }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.v === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-muted/60 text-foreground hover:bg-muted/90 transition-colors"
      >
        <current.icon size={12} />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            role="listbox"
            aria-label={ariaLabel}
            className="absolute right-0 top-full mt-1.5 z-20 min-w-[9.5rem] rounded-xl border border-border bg-card shadow-lg p-1 origin-top-right"
          >
            {options.map(({ v, label, icon: Icon }) => {
              const isActive = v === value
              return (
                <button
                  key={v}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { onChange(v); setOpen(false) }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    isActive ? 'bg-brand-subtle text-primary' : 'text-foreground hover:bg-muted/60'
                  }`}
                >
                  <Icon size={13} />
                  {label}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PortfolioSkeleton() {
  return (
    <div className="pt-6 pb-4">
      <div className="flex justify-between items-center px-4 mb-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-7 w-32 rounded-lg" />
      </div>
      <div className="px-4 mb-3">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
      <div className="flex gap-2 px-4 mb-3">
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
      <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] sm:aspect-square w-full rounded-2xl" />
        ))}
      </div>
    </div>
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
  // Set in Settings → Appearance → Asset view; read once at mount, same as
  // isMobile above — Portfolio remounts on route navigation, so a fresh
  // read here already reflects whatever was last chosen in Settings.
  const [assetView] = useState(() => config.assetView)
  const isListView = assetView === 'list'

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
    if (config.finnhubApiKey) {
      try {
        await refreshAllPrices(config.finnhubApiKey)
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
      return 0
    })

    return result
  }, [assets, search, activeType, sort])

  if (!assetsLoaded) {
    return <PortfolioSkeleton />
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="pt-6 pb-4 px-4">
        <h1 className="text-xl font-bold">Portfolio</h1>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="mt-4 rounded-2xl border border-border bg-card p-6 text-center"
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
            <PackageOpen size={20} className="text-primary" />
          </div>
          <p className="font-syne text-2xl font-bold tracking-tight text-foreground">Add an asset first.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Portfolio data appears after your first asset is added.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="pt-6 pb-4">
      <div className="flex justify-between items-center px-4 mb-3">
        <div>
          <h1 className="text-xl font-bold">Portfolio</h1>
          {formatRelativeTime(pricesRefreshedAt) && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Prices {formatRelativeTime(pricesRefreshedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <OptionDropdown value={sort} options={SORT_OPTIONS} onChange={setSort} ariaLabel="Sort by" />
        </div>
      </div>

      <div className="px-4 mb-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search positions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-muted/70 rounded-xl pl-9 pr-9 py-2.5 text-sm w-full border border-transparent focus:border-primary/40 focus:bg-card transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <AnimatePresence>
            {search && (
              <motion.button
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={15} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <LayoutGroup id="type-chips">
        <div className="flex gap-2 overflow-x-auto px-4 mb-3 pb-1 no-scrollbar">
          {chips.map((type) => {
            const isActive = activeType === type
            return (
              <button
                key={type}
                onClick={() => setActiveType(type)}
                className={`relative text-xs px-3 py-1.5 rounded-full shrink-0 transition-colors duration-150 ${
                  isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground border border-border'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="chip-pill"
                    className="absolute inset-0 rounded-full bg-primary -z-10"
                    transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                  />
                )}
                {type}
              </button>
            )
          })}
        </div>
      </LayoutGroup>

      {/*
        No AnimatePresence here: this view re-renders on every keystroke
        (search) and filter/sort change, nested inside AppLayout's
        route-transition AnimatePresence. That combination — an inner
        AnimatePresence whose exit-tracking doesn't reliably resolve before
        the outer one tries to unmount the whole page — is what caused the
        production bug where visiting this page left every subsequent
        page's content invisible until a reload. PositionCard still fades
        in on mount/filter via its own initial/animate; it just doesn't get
        an exit animation when filtered out.
      */}
      {isListView ? (
        <div>
          {displayed.map((a, i) => (
            <PositionCard key={a.id} asset={a} index={i} layout="list" />
          ))}
        </div>
      ) : (
        <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {displayed.map((a, i) => (
            <PositionCard key={a.id} asset={a} index={i} />
          ))}
        </div>
      )}

      {assets.length > 0 && displayed.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center mt-16 px-4"
        >
          <SearchX size={22} className="text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground text-center text-sm">
            No results match your search.
          </p>
        </motion.div>
      )}
    </div>
    </>
  )
}
