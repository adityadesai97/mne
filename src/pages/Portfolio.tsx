// src/pages/Portfolio.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { Search, X, ArrowDownAZ, ArrowDownWideNarrow, TrendingUpDown, PackageOpen, SearchX, LayoutGrid, List, Boxes, ChevronDown } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { PositionCard } from '@/components/PositionCard'
import { Skeleton } from '@/components/ui/skeleton'
import { computeAssetValue, computeCostBasis, computeUnrealizedGain, computeTotalNetWorth } from '@/lib/portfolio'
import { colorForAssetType } from '@/lib/typeColors'
import { showAppAlert } from '@/lib/appAlerts'

const PRICES_REFRESHED_AT_KEY = 'mne_prices_refreshed_at'
const PORTFOLIO_LAYOUT_KEY = 'mne_portfolio_layout'
const TOOLTIP_BG = 'hsl(224,13%,9%)'

type LayoutMode = 'grid' | 'list' | 'treemap'
const LAYOUT_OPTIONS: { v: LayoutMode; label: string; icon: React.ElementType }[] = [
  { v: 'grid', label: 'Grid', icon: LayoutGrid },
  { v: 'list', label: 'List', icon: List },
  { v: 'treemap', label: 'Treemap', icon: Boxes },
]

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

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
 * Shared dropdown for both the sort and layout controls — a single button
 * showing the current selection (icon + label) that opens a small menu of
 * the other options. Replaces the earlier segmented-toggle button groups,
 * which took up more header width the more options they had.
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
      <div className="px-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[148px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function Portfolio() {
  const navigate = useNavigate()
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [activeType, setActiveType] = useState<string>('All')
  const [sort, setSort] = useState<SortOption>('name')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [pricesRefreshedAt, setPricesRefreshedAt] = useState<string | null>(
    () => localStorage.getItem(PRICES_REFRESHED_AT_KEY)
  )
  // Grid is visually rich (accent bars, allocation footers) — with a large
  // portfolio that reads as "busy". List and Treemap are lower-chrome
  // alternatives for the same data; preference persists across visits.
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(
    () => (localStorage.getItem(PORTFOLIO_LAYOUT_KEY) as LayoutMode | null) ?? 'grid'
  )

  function setLayoutMode(mode: LayoutMode) {
    localStorage.setItem(PORTFOLIO_LAYOUT_KEY, mode)
    setLayoutModeState(mode)
  }

  useEffect(() => {
    getAllAssets()
      .then(setAssets)
      .catch(() => showAppAlert('Failed to load portfolio data. Please refresh.', { variant: 'error' }))
      .finally(() => setAssetsLoaded(true))
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

  const portfolioTotal = useMemo(() => computeTotalNetWorth(assets), [assets])

  // The Name/Value/Gain picker only changes anything meaningful in List —
  // that's the one layout where row order is the whole story. Grid is a
  // wall of same-size tiles where "largest first" is the only ordering
  // that reads as intentional rather than arbitrary, and Treemap already
  // determines box size (and therefore visual order) from value, so
  // sorting it by name/gain would fight its own layout. So: List honors
  // whatever the user picked; Grid and Treemap always order by value,
  // regardless of what the (hidden, in those modes) sort control last held.
  const effectiveSort: SortOption = layoutMode === 'list' ? sort : 'value'

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
      if (effectiveSort === 'name') {
        return (a.name ?? '').localeCompare(b.name ?? '')
      }
      if (effectiveSort === 'value') {
        return computeAssetValue(b) - computeAssetValue(a)
      }
      if (effectiveSort === 'gain') {
        return computeUnrealizedGain(b) - computeUnrealizedGain(a)
      }
      return 0
    })

    return result
  }, [assets, search, activeType, effectiveSort])

  const treemapOption = useMemo<EChartsOption>(() => {
    // Same accent-color-per-type language as the grid's top bar and the
    // list's left bar, plus the same gain/loss figures those two views show
    // directly — printed in-box below via the label formatter, with "of
    // portfolio" (a figure the box's own size already communicates
    // visually) reserved for the tooltip. Zero-value positions (no price
    // data yet) are excluded rather than rendered as an invisible sliver.
    const nodes = displayed
      .map((a, i) => ({ a, i, value: computeAssetValue(a), gain: computeUnrealizedGain(a) }))
      .filter(({ value }) => value > 0)

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: TOOLTIP_BG,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        textStyle: { color: 'hsl(215,20%,96%)', fontSize: 12 },
        extraCssText: 'border-radius: 10px; padding: 8px 10px;',
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number; data: { gain: number; gainPct: number; sharePct: number; isStock: boolean } }
          const { gain, gainPct, sharePct, isStock } = p.data
          const isGain = gain >= 0
          const gainLine = isStock
            ? `<br/><span style="color:${isGain ? 'hsl(var(--gain))' : 'hsl(var(--loss))'}">${isGain ? '+' : ''}${fmtCurrency(gain)} (${gainPct.toFixed(1)}%)</span>`
            : ''
          return `<strong>${p.name}</strong><br/>${fmtCurrency(p.value)}${gainLine}<br/><span style="opacity:0.7">${sharePct.toFixed(1)}% of portfolio</span>`
        },
      },
      series: [
        {
          type: 'treemap',
          data: nodes.map(({ a, i, value, gain }) => {
            const cost = computeCostBasis(a)
            const gainPct = cost > 0 ? (gain / cost) * 100 : 0
            const sharePct = portfolioTotal > 0 ? (value / portfolioTotal) * 100 : 0
            return {
              name: a.name,
              value,
              assetId: a.id,
              gain,
              gainPct,
              sharePct,
              isStock: a.asset_type === 'Stock',
              itemStyle: { color: colorForAssetType(a.asset_type, i) },
            }
          }),
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          // Boxes are big enough on most positions to carry the same figures
          // Grid and List print directly (value, and gain% for stocks) —
          // printing them here too means the tooltip is a hover nicety, not
          // the only way to read a box. Anchored top-left (vs. centered) so
          // it reads like a card header even on wide, short boxes; overflow
          // is truncated rather than spilling past a small box's edge, and
          // boxes too small to hold a line of text just drop it (ECharts'
          // default behavior) rather than overlapping neighbors.
          label: {
            show: true,
            position: 'insideTopLeft',
            padding: 8,
            overflow: 'truncate',
            textShadowColor: 'rgba(0,0,0,0.35)',
            textShadowBlur: 3,
            rich: {
              name: { fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 16 },
              value: { fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 15 },
              gain: { fontSize: 11, fontWeight: 600, color: 'hsl(var(--gain))', lineHeight: 15 },
              loss: { fontSize: 11, fontWeight: 600, color: 'hsl(var(--loss))', lineHeight: 15 },
            },
            formatter: (params: unknown) => {
              const p = params as { name: string; data: { value: number; gain: number; gainPct: number; isStock: boolean } }
              const { value, gain, gainPct, isStock } = p.data
              const lines = [`{name|${p.name}}`, `{value|${fmtCurrency(value)}}`]
              if (isStock) {
                const isGain = gain >= 0
                lines.push(`{${isGain ? 'gain' : 'loss'}|${isGain ? '+' : ''}${gainPct.toFixed(1)}%}`)
              }
              return lines.join('\n')
            },
          },
          upperLabel: { show: false },
          // gapWidth mirrors the grid's gap-3 between cards; borderRadius
          // matches the rounded-2xl card language used everywhere else.
          itemStyle: { borderColor: 'hsl(var(--background))', borderWidth: 3, gapWidth: 3, borderRadius: 8 },
          emphasis: { itemStyle: { borderColor: 'hsl(215,20%,96%)' } },
        },
      ],
    }
  }, [displayed, portfolioTotal])

  const handleTreemapClick = useCallback((params: any) => {
    if (params?.data?.assetId) navigate(`/portfolio/${params.data.assetId}`)
  }, [navigate])

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
          <OptionDropdown value={layoutMode} options={LAYOUT_OPTIONS} onChange={setLayoutMode} ariaLabel="Layout" />
          {layoutMode === 'list' && (
            <OptionDropdown value={sort} options={SORT_OPTIONS} onChange={setSort} ariaLabel="Sort by" />
          )}
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
        (search) and filter/sort/layout change, nested inside AppLayout's
        route-transition AnimatePresence. That combination — an inner
        AnimatePresence whose exit-tracking doesn't reliably resolve before
        the outer one tries to unmount the whole page — is what caused the
        production bug where visiting this page left every subsequent
        page's content invisible until a reload. PositionCard still fades
        in on mount/filter via its own initial/animate; it just doesn't get
        an exit animation when filtered out.

        Three layouts over the same data: Grid is a "wall" of tiles (richest,
        can feel busy with many positions); List is one calm compact row per
        position; Treemap sizes each position by its share of the portfolio.
      */}
      {layoutMode === 'grid' && (
        <div className="px-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {displayed.map((a, i) => (
            <PositionCard key={a.id} asset={a} index={i} />
          ))}
        </div>
      )}

      {layoutMode === 'list' && (
        <div>
          {displayed.map((a, i) => (
            <PositionCard key={a.id} asset={a} index={i} layout="list" />
          ))}
        </div>
      )}

      {layoutMode === 'treemap' && displayed.length > 0 && (
        <div className="px-4">
          <ReactECharts
            option={treemapOption}
            style={{ width: '100%', height: isMobile ? 380 : 480 }}
            notMerge
            opts={{ renderer: 'svg' }}
            onEvents={{ click: handleTreemapClick }}
          />
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
