// src/pages/Home.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { TrendingUp, TrendingDown, Sparkles, Sunrise, Sun, Sunset, Moon, Lightbulb, RefreshCw, Wallet, PieChart, Activity, Crown } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { getAllAssets } from '@/lib/db/assets'
import { getSnapshots } from '@/lib/db/snapshots'
import { computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeAssetValue, computeDailyChange } from '@/lib/portfolio'
import { getSupabaseClient } from '@/lib/supabase'
import { refreshAllPrices } from '@/lib/db/tickers'
import { refreshPricesOncePerLoad, PRICES_REFRESHED_AT_KEY } from '@/lib/priceRefresh'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { Skeleton } from '@/components/ui/skeleton'
import { CardEyebrow } from '@/components/CardEyebrow'
import { revealUp } from '@/lib/motionPresets'
import { colorForAssetType } from '@/lib/typeColors'
import { showAppAlert } from '@/lib/appAlerts'

const HOME_CHART_RANGE_KEY = 'mne_home_chart_range'
const HOME_CHART_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const
type HomeChartRange = typeof HOME_CHART_RANGES[number]

function getGreeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours()
  if (hour < 5) return { text: 'Good night', Icon: Moon }
  if (hour < 12) return { text: 'Good morning', Icon: Sunrise }
  if (hour < 17) return { text: 'Good afternoon', Icon: Sun }
  if (hour < 21) return { text: 'Good evening', Icon: Sunset }
  return { text: 'Good night', Icon: Moon }
}

const AXIS_COLOR = 'hsl(215,14%,55%)'
const TOOLTIP_BG = 'hsl(224,13%,9%)'
const GRID_COLOR = 'hsl(224,13%,16%)'
const LINE_COLOR = 'hsl(217,91%,60%)'

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function formatDateCompact(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(parsed)
}

function formatDateShort(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function useAnimatedNumber(target: number, ref: React.RefObject<HTMLElement | null>, format = fmtCurrency) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const controls = animate(0, target, {
      duration: 1.4,
      ease: [0.25, 0.1, 0.25, 1],
      onUpdate: (v) => { node.textContent = format(v) },
    })
    return () => controls.stop()
  }, [target])
}

export default function Home() {
  const [assets, setAssets] = useState<any[]>([])
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [homeChartRange, setHomeChartRangeState] = useState<HomeChartRange>(
    () => (localStorage.getItem(HOME_CHART_RANGE_KEY) as HomeChartRange | null) ?? '1Y'
  )
  const [insightIndex, setInsightIndex] = useState(0)
  const [moverSort, setMoverSort] = useState<'percent' | 'value'>('percent')
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false)
  const heroRef = useRef<HTMLParagraphElement>(null)
  const greeting = useMemo(() => getGreeting(), [])

  function handleRangeChange(range: HomeChartRange) {
    localStorage.setItem(HOME_CHART_RANGE_KEY, range)
    setHomeChartRangeState(range)
  }

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
    getSupabaseClient().auth.getUser().then(({ data }) => {
      const name = data.user?.user_metadata?.full_name ?? data.user?.user_metadata?.name
      if (name) setFirstName(name.split(' ')[0])
    })
  }, [])

  useEffect(() => {
    if (!assetsLoaded || assets.length === 0) {
      setSnapshots([])
      return
    }
    getSnapshots().then(setSnapshots).catch(() => {
      // snapshots are non-critical; no alert needed
    })
  }, [assetsLoaded, assets.length])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (config.finnhubApiKey) {
      try {
        await refreshAllPrices(config.finnhubApiKey)
        // Portfolio still shows a "Prices refreshed" timestamp read from
        // this key, even though Home's own copy of that display is gone.
        localStorage.setItem(PRICES_REFRESHED_AT_KEY, new Date().toISOString())
      } catch {
        showAppAlert('Price refresh failed. Check your Finnhub API key.', { variant: 'error' })
      }
    }
    const [fresh] = await Promise.all([
      getAllAssets().catch(() => {
        showAppAlert('Failed to reload portfolio.', { variant: 'error' })
        return assets
      }),
      getSnapshots().then(setSnapshots).catch(() => {}),
    ])
    setAssets((fresh as any[]) ?? assets)
  }, [assets])

  const { refreshing, pullY } = usePullToRefresh(handleRefresh, isMobile)

  // Explicit click-to-refresh — pull-to-refresh only fires on touch input, so
  // desktop/mouse users would otherwise have no way to force a price refresh
  // and just have to wait for the hourly check-prices cron.
  const handleManualRefresh = useCallback(async () => {
    if (isRefreshingPrices) return
    setIsRefreshingPrices(true)
    try {
      await handleRefresh()
    } finally {
      setIsRefreshingPrices(false)
    }
  }, [handleRefresh, isRefreshingPrices])

  const totalValue = computeTotalNetWorth(assets)

  const netWorthSeries = useMemo(() => {
    const valid = snapshots
      .filter((point) => point?.date && Number.isFinite(Number(point.value)))
      .map((point) => ({ date: point.date, value: Number(point.value) }))

    if (valid.length === 0) {
      const today = new Date().toISOString().slice(0, 10)
      return [{ date: today, value: totalValue }]
    }

    if (valid.length <= 1 || homeChartRange === 'ALL') return valid

    const latest = valid[valid.length - 1]
    const endDate = new Date(`${latest.date}T00:00:00`)
    if (Number.isNaN(endDate.getTime())) return valid

    const startDate = new Date(endDate)
    if (homeChartRange === '1M') startDate.setMonth(startDate.getMonth() - 1)
    if (homeChartRange === '3M') startDate.setMonth(startDate.getMonth() - 3)
    if (homeChartRange === '6M') startDate.setMonth(startDate.getMonth() - 6)
    if (homeChartRange === '1Y') startDate.setFullYear(startDate.getFullYear() - 1)

    const filtered = valid.filter(point => {
      const d = new Date(`${point.date}T00:00:00`)
      return !Number.isNaN(d.getTime()) && d >= startDate
    })
    return filtered.length >= 2 ? filtered : valid.slice(Math.max(0, valid.length - 2))
  }, [snapshots, totalValue, homeChartRange])

  const netWorthValues = useMemo(() => netWorthSeries.map((point) => point.value), [netWorthSeries])
  const netWorthCount = netWorthValues.length
  const netWorthBounds = useMemo(() => {
    if (!netWorthValues.length) return { min: 0, max: 0 }

    const min = Math.min(...netWorthValues)
    const max = Math.max(...netWorthValues)
    const range = Math.max(max - min, Math.max(1, Math.abs(max) * 0.04))
    const pad = range * (netWorthCount <= 2 ? 0.35 : 0.18)
    return { min: min - pad, max: max + pad }
  }, [netWorthCount, netWorthValues])

  const netWorthOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: TOOLTIP_BG,
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      textStyle: { color: 'hsl(215,20%,96%)', fontSize: 12 },
      trigger: 'axis',
      // Scrub feel: a vertical crosshair follows the cursor/touch drag along
      // the line, so you can trace net worth on any specific day rather than
      // only seeing the overall shape.
      axisPointer: {
        type: 'line',
        lineStyle: { color: LINE_COLOR, opacity: 0.35, width: 1.5 },
        label: { show: false },
      },
      extraCssText: 'border-radius: 10px; padding: 6px 10px;',
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; value: number | [string, number] }>
        if (!rows.length) return ''
        const first = rows[0]
        const raw = first.value
        const value = Array.isArray(raw) ? Number(raw[1]) : Number(raw)
        return `${formatDateShort(first.axisValue)}<br/>${fmtCurrency(value)}`
      },
    },
    grid: {
      left: isMobile ? 4 : 2,
      right: isMobile ? 6 : 4,
      top: 6,
      bottom: isMobile ? 24 : 22,
      containLabel: false,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: netWorthSeries.map((point) => point.date),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS_COLOR,
        fontSize: 10,
        margin: 8,
        showMinLabel: true,
        showMaxLabel: true,
        hideOverlap: false,
        formatter: (value: string) => formatDateCompact(value),
      },
    },
    yAxis: {
      type: 'value',
      show: false,
      min: netWorthBounds.min,
      max: netWorthBounds.max,
      splitLine: { lineStyle: { color: GRID_COLOR, type: 'dashed' } },
    },
    series: [
      {
        name: 'Net Worth',
        type: 'line',
        smooth: netWorthCount > 2,
        symbol: netWorthCount <= 2 ? 'circle' : 'none',
        symbolSize: 6,
        clip: true,
        lineStyle: { width: 2.25, color: LINE_COLOR },
        areaStyle: {
          opacity: netWorthCount <= 2 ? 0.05 : 0.08,
          color: LINE_COLOR,
          origin: 'start',
        },
        emphasis: {
          scale: 1.4,
          itemStyle: { color: LINE_COLOR, borderColor: 'hsl(224,13%,9%)', borderWidth: 2 },
        },
        data: netWorthValues,
      },
    ],
  }), [isMobile, netWorthBounds.max, netWorthBounds.min, netWorthCount, netWorthSeries, netWorthValues])

  // Sum each position's own gain/loss (the same figure shown on its Portfolio card)
  // rather than re-deriving from separately-summed totals — keeps this tile always
  // equal to the sum of the individual P/L numbers the user sees elsewhere.
  const stockAssets = assets.filter((asset) => asset.asset_type === 'Stock')
  const stockTotalCost = stockAssets.reduce((sum, asset) => sum + computeCostBasis(asset), 0)
  const stockGainLoss = stockAssets.reduce((sum, asset) => sum + computeUnrealizedGain(asset), 0)
  const stockGainLossPercent = stockTotalCost > 0 ? (stockGainLoss / stockTotalCost) * 100 : 0
  const stockIsGain = stockGainLoss >= 0

  useAnimatedNumber(totalValue, heroRef)

  // Best performer
  const bestAsset = stockAssets.reduce<any | null>((best, a) => {
    const gain = computeUnrealizedGain(a)
    if (best === null || gain > computeUnrealizedGain(best)) return a
    return best
  }, null)
  const bestAssetGain = bestAsset ? computeUnrealizedGain(bestAsset) : 0
  const bestAssetCost = bestAsset ? computeCostBasis(bestAsset) : 0
  const bestAssetGainPct = bestAssetCost > 0 ? (bestAssetGain / bestAssetCost) * 100 : 0

  // Largest holding by value
  const largestAsset = assets.reduce<any | null>((top, a) => {
    const v = computeAssetValue(a)
    if (top === null || v > computeAssetValue(top)) return a
    return top
  }, null)
  const largestValue = largestAsset ? computeAssetValue(largestAsset) : 0
  const largestPct = totalValue > 0 ? (largestValue / totalValue) * 100 : 0

  // Allocation by asset type
  const byType = assets.reduce<Record<string, number>>((acc, a) => {
    const v = computeAssetValue(a)
    acc[a.asset_type] = (acc[a.asset_type] || 0) + v
    return acc
  }, {})
  const typeEntries = Object.entries(byType)
    .map(([name, value]) => ({ name, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
  const uniqueAssetTypes = typeEntries.length

  // Daily movers — today's price move per stock position, from each
  // ticker's last-refreshed quote (current_price vs previous_close), not
  // the net worth snapshot series. Positions without a previous_close yet
  // (never refreshed since this field was added) are excluded rather than
  // shown as a false 0% move.
  const dailyMovers = useMemo(() => {
    return stockAssets
      .map((a) => {
        const change = computeDailyChange(a)
        if (!change) return null
        return {
          id: a.id,
          symbol: a.ticker?.symbol ?? a.name,
          name: a.name,
          dollarChange: change.dollarChange,
          percentChange: change.percentChange,
        }
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
  }, [stockAssets])

  const sortedMovers = useMemo(() => {
    const key = moverSort === 'percent' ? 'percentChange' : 'dollarChange'
    return [...dailyMovers].sort((a, b) => Math.abs(b[key]) - Math.abs(a[key])).slice(0, 5)
  }, [dailyMovers, moverSort])

  // Today's change, from the tail of the net worth series (today's snapshot
  // vs yesterday's, one row per day) — drives both the ambient glow's color
  // and the daily change figure shown under the hero number.
  const previousNetWorthValue = netWorthValues.length >= 2 ? netWorthValues[netWorthValues.length - 2] : null
  const todayChange = netWorthValues.length >= 2
    ? netWorthValues[netWorthValues.length - 1] - previousNetWorthValue!
    : 0
  const todayChangePercent = previousNetWorthValue ? (todayChange / previousNetWorthValue) * 100 : 0
  const hasMood = netWorthValues.length >= 2 && todayChange !== 0
  const moodIsPositive = todayChange >= 0

  // Short rotating one-liners for the insight ticker — all derived from data
  // already on screen elsewhere, nothing fabricated.
  const insights = useMemo(() => {
    const list: string[] = []
    if (bestAsset && bestAssetGainPct !== 0) {
      const label = bestAsset.ticker?.symbol ?? bestAsset.name
      list.push(`${label} is your best performer, ${bestAssetGain >= 0 ? 'up' : 'down'} ${Math.abs(bestAssetGainPct).toFixed(1)}%`)
    }
    if (largestAsset) {
      list.push(`${largestAsset.name} makes up ${largestPct.toFixed(0)}% of your portfolio`)
    }
    if (stockGainLoss !== 0) {
      list.push(`Your stocks are ${stockIsGain ? 'up' : 'down'} ${Math.abs(stockGainLossPercent).toFixed(1)}% overall`)
    }
    if (uniqueAssetTypes > 1) {
      list.push(`Spread across ${uniqueAssetTypes} asset types`)
    }
    if (assets.length > 0) {
      list.push(`Tracking ${assets.length} position${assets.length === 1 ? '' : 's'}`)
    }
    return list
  }, [bestAsset, bestAssetGain, bestAssetGainPct, largestAsset, largestPct, stockGainLoss, stockGainLossPercent, stockIsGain, uniqueAssetTypes, assets.length])

  useEffect(() => {
    if (insights.length <= 1) return
    const id = window.setInterval(() => {
      setInsightIndex((i) => (i + 1) % insights.length)
    }, 4500)
    return () => window.clearInterval(id)
  }, [insights.length])

  if (!assetsLoaded) {
    return (
      <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-4 md:row-span-2 bg-card shadow-card rounded-2xl p-5 space-y-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-11 w-56" />
            <Skeleton className="h-[130px] w-full rounded-xl" />
          </div>
          <div className="md:col-span-2 bg-card shadow-card rounded-2xl p-5 space-y-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="md:col-span-2 bg-card shadow-card rounded-2xl p-5 space-y-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-full" />
          </div>
          <div className="md:col-span-4 bg-card shadow-card rounded-2xl p-5">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <Skeleton className="md:col-span-1 h-24 w-full rounded-2xl" />
          <Skeleton className="md:col-span-1 h-24 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6">
        <motion.div
          {...revealUp(0)}
          className="bg-card shadow-card rounded-2xl p-6 md:p-7 border border-border/70 relative overflow-hidden"
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-8 left-1/4 w-72 h-36 bg-brand-subtle rounded-full blur-3xl" />
          </div>
          <div className="relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle">
            <Sparkles size={18} className="text-primary" />
          </div>
          <p className="relative text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium">
            {firstName ? `${firstName}'s Workspace` : 'Workspace'}
          </p>
          <h1 className="relative font-syne text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight">
            Add your first asset to get started.
          </h1>
          <p className="relative mt-4 text-sm md:text-base text-muted-foreground max-w-2xl">
            Portfolio and Charts unlock after your first asset is added. Use the command button to record a position.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6 space-y-3">

      {/* GREETING */}
      <motion.div {...revealUp(0)} className="flex items-center gap-2.5 px-1">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-subtle">
          <greeting.Icon size={16} className="text-primary" aria-hidden="true" />
        </div>
        <p className="font-syne text-lg md:text-xl font-bold text-foreground tracking-tight">
          {greeting.text}{firstName ? `, ${firstName}` : ''}
        </p>
      </motion.div>

      {/* BENTO GRID — one shared 6-column grid (rather than three separate
          stacked grids) so cards can be genuinely different sizes and not
          line up row after row. Net Worth is a tall 4x2 tile; Allocation and
          P&L stack in the remaining 2x2 area beside it; Daily Movers, Best
          Performer, and Largest Holding split the row below unevenly
          (4 + 1 + 1). Every card shares the same p-5 padding, rounded-2xl
          corners, and hover lift regardless of its span. */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">

        {/* NET WORTH HERO */}
        <motion.div
          {...revealUp(0)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="md:col-span-4 md:row-span-2 bg-card shadow-card rounded-2xl p-5 relative overflow-hidden"
        >
          {/* Ambient glow — neutral brand color until there's a day-over-day
              change to react to, then tints toward gain/loss color. */}
          <div className="absolute inset-0 pointer-events-none">
            <div
              className={`absolute -top-8 left-1/4 w-72 h-36 rounded-full blur-3xl transition-colors duration-700 ${
                hasMood ? (moodIsPositive ? 'bg-gain/[0.16] animate-pulse' : 'bg-loss/[0.16] animate-pulse') : 'bg-brand-subtle'
              }`}
            />
          </div>

          <div className="mb-3 relative">
            <CardEyebrow icon={Wallet}>Net Worth</CardEyebrow>
          </div>

          <div className="mb-1 relative">
            <p
              ref={heroRef}
              className="text-[2.6rem] md:text-[3.1rem] font-bold tabular-nums tracking-tight leading-none font-syne"
            >
              {fmtCurrency(totalValue)}
            </p>
          </div>

          {hasMood && Math.abs(todayChange) >= 1 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className={`mb-4 relative inline-flex items-center gap-1 text-[11px] ${moodIsPositive ? 'text-gain' : 'text-loss'}`}
            >
              {moodIsPositive ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
              <span>
                {todayChange >= 0 ? '+' : ''}{fmtCurrency(todayChange)} ({todayChange >= 0 ? '+' : ''}{todayChangePercent.toFixed(2)}%) today
              </span>
            </motion.div>
          ) : (
            <div className="mb-4" />
          )}

          {/* Chart range selector */}
          <div className="flex items-center justify-end gap-1.5 mb-1.5 relative">
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshingPrices}
              title="Refresh prices"
              aria-label="Refresh prices"
              className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground hover:text-foreground disabled:opacity-60 transition-colors"
            >
              <RefreshCw size={11} className={isRefreshingPrices ? 'animate-spin' : ''} />
            </button>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
              {HOME_CHART_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRangeChange(r)}
                  className={`text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${
                    homeChartRange === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="relative mb-4 -mx-1">
            <ReactECharts
              option={netWorthOption}
              style={{ width: '100%', height: isMobile ? 130 : 150 }}
              notMerge
              opts={{ renderer: 'svg' }}
            />
          </div>

          {/* Mini meta row — positions + asset types */}
          <div className="flex gap-5 pt-3 border-t border-white/[0.05] relative">
            <div>
              <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Positions</p>
              <p className="text-sm font-medium tabular-nums mt-0.5">{assets.length}</p>
            </div>
            <div className="w-px bg-border" />
            <div>
              <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Asset Types</p>
              <p className="text-sm font-medium tabular-nums mt-0.5">{uniqueAssetTypes}</p>
            </div>
          </div>

          {/* Rotating insight ticker */}
          {insights.length > 0 && (
            <div className="flex items-center gap-1.5 pt-2.5 mt-2.5 border-t border-white/[0.05] relative text-xs text-muted-foreground overflow-hidden">
              <Lightbulb size={12} className="flex-shrink-0 text-primary/70" aria-hidden="true" />
              <AnimatePresence mode="wait">
                <motion.span
                  key={insights[insightIndex % insights.length]}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="truncate"
                >
                  {insights[insightIndex % insights.length]}
                </motion.span>
              </AnimatePresence>
            </div>
          )}
        </motion.div>

        {/* ALLOCATION */}
        <motion.div
          {...revealUp(0.05)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="md:col-span-2 bg-card shadow-card rounded-2xl p-5"
        >
          <div className="mb-3">
            <CardEyebrow icon={PieChart}>Allocation</CardEyebrow>
          </div>

          {typeEntries.length === 0 ? (
            <p className="text-muted-foreground text-xs mt-2">No assets yet</p>
          ) : (
            <div className="space-y-3.5">
              {typeEntries.map(({ name, value, pct }, i) => {
                const color = colorForAssetType(name, i)
                return (
                  <div key={name}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs font-medium">{name}</span>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-[3px] bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.15 + i * 0.06, duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    </div>
                    <p className="text-[10px] tabular-nums text-muted-foreground mt-1">{fmtCurrency(value)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </motion.div>

        {/* P&L — placed here (not in the row below) so it fills the 2x1 gap
            beside Net Worth's second row instead of lining up with
            Allocation directly above it. */}
        <motion.div
          {...revealUp(0.1)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="bg-card shadow-card rounded-2xl p-5 md:col-span-2"
        >
          <div className="mb-3">
            <CardEyebrow icon={stockIsGain ? TrendingUp : TrendingDown} className={stockIsGain ? 'text-gain' : 'text-loss'}>P&L</CardEyebrow>
          </div>
          <p className={`text-lg font-bold tabular-nums leading-tight font-syne ${stockIsGain ? 'text-gain' : 'text-loss'}`}>
            {stockIsGain ? '+' : ''}{fmtCurrency(stockGainLoss)}
          </p>
          <p className={`text-[10px] tabular-nums mt-0.5 ${stockIsGain ? 'text-gain' : 'text-loss'}`}>
            {stockIsGain ? '+' : ''}{stockGainLossPercent.toFixed(2)}%
          </p>
        </motion.div>

        {/* DAILY MOVERS */}
        {dailyMovers.length > 0 && (
        <motion.div
          {...revealUp(0.13)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="md:col-span-4 bg-card shadow-card rounded-2xl p-5"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <CardEyebrow icon={Activity}>Daily Movers</CardEyebrow>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setMoverSort('percent')}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                  moverSort === 'percent' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                By %
              </button>
              <button
                type="button"
                onClick={() => setMoverSort('value')}
                className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                  moverSort === 'value' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                By Value
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {sortedMovers.map((mover, i) => {
              const isGain = mover.dollarChange >= 0
              return (
                <motion.div
                  key={mover.id}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.05 * i, duration: 0.3 }}
                  className="rounded-xl bg-muted/40 p-3"
                >
                  <div className="flex items-center gap-1 mb-1.5">
                    {isGain
                      ? <TrendingUp size={11} className="text-gain flex-shrink-0" />
                      : <TrendingDown size={11} className="text-loss flex-shrink-0" />}
                    <p className="text-xs font-semibold truncate">{mover.symbol}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mb-1.5">{mover.name}</p>
                  <p className={`text-sm font-bold tabular-nums font-syne ${isGain ? 'text-gain' : 'text-loss'}`}>
                    {isGain ? '+' : ''}{mover.percentChange.toFixed(2)}%
                  </p>
                  <p className={`text-[10px] tabular-nums ${isGain ? 'text-gain' : 'text-loss'}`}>
                    {isGain ? '+' : ''}{fmtCurrency(mover.dollarChange)}
                  </p>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
        )}

        {/* BEST PERFORMER — no ring/infographic here: a percentage ring next
            to a percentage in text was two representations of the same
            fact. Just the two complementary numbers (dollar gain, then
            percent), matching how P&L presents its figures. */}
        <motion.div
          {...revealUp(0.16)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="md:col-span-1 bg-card shadow-card rounded-2xl p-5"
        >
          <div className="mb-3">
            <CardEyebrow icon={bestAssetGain >= 0 ? TrendingUp : TrendingDown} className={bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}>Best Performer</CardEyebrow>
          </div>
          <p className="text-sm font-semibold truncate">{bestAsset?.name ?? '—'}</p>
          {bestAsset && (
            <p className={`text-lg font-bold tabular-nums font-syne mt-1 ${bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}`}>
              {bestAssetGain >= 0 ? '+' : ''}{fmtCurrency(bestAssetGain)}
            </p>
          )}
          {bestAsset && (
            <p className={`text-[10px] tabular-nums ${bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}`}>
              {bestAssetGain >= 0 ? '+' : ''}{bestAssetGainPct.toFixed(2)}%
            </p>
          )}
        </motion.div>

        {/* LARGEST HOLDING — same reasoning as Best Performer: one set of
            numbers (dollar value, then share of portfolio), no ring. */}
        <motion.div
          {...revealUp(0.19)}
          whileHover={{ y: -2, transition: { duration: 0.15, delay: 0 } }}
          className="md:col-span-1 bg-card shadow-card rounded-2xl p-5"
        >
          <div className="mb-3">
            <CardEyebrow icon={Crown} className="text-primary">Largest Holding</CardEyebrow>
          </div>
          <p className="text-sm font-semibold truncate">{largestAsset?.name ?? '—'}</p>
          {largestAsset && (
            <p className="text-lg font-bold tabular-nums font-syne mt-1">{fmtCurrency(largestValue)}</p>
          )}
          {largestAsset && (
            <p className="text-[10px] tabular-nums text-muted-foreground">{largestPct.toFixed(1)}% of portfolio</p>
          )}
        </motion.div>

      </div>
    </div>
    </>
  )
}
