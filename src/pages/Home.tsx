// src/pages/Home.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { animate } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { getAllAssets } from '@/lib/db/assets'
import { getSnapshots } from '@/lib/db/snapshots'
import { computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeAssetValue } from '@/lib/portfolio'
import { getSupabaseClient } from '@/lib/supabase'

const TYPE_COLORS: Record<string, string> = {
  Stock: '#3B82F6',
  Cash: '#10B981',
  '401k': '#F59E0B',
  CD: '#8B5CF6',
  'Real Estate': '#EC4899',
  Other: '#6B7280',
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

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
})

export default function Home() {
  const [assets, setAssets] = useState<any[]>([])
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [firstName, setFirstName] = useState<string | null>(null)
  const heroRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    getAllAssets()
      .then(setAssets)
      .catch(console.error)
      .finally(() => setAssetsLoaded(true))
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
    getSnapshots().then(setSnapshots).catch(console.error)
  }, [assetsLoaded, assets.length])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const totalValue = computeTotalNetWorth(assets)

  const netWorthSeries = useMemo(() => {
    const valid = snapshots
      .filter((point) => point?.date && Number.isFinite(Number(point.value)))
      .map((point) => ({ date: point.date, value: Number(point.value) }))

    if (valid.length > 0) return valid

    const today = new Date().toISOString().slice(0, 10)
    return [{ date: today, value: totalValue }]
  }, [snapshots, totalValue])

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
        data: netWorthValues,
      },
    ],
  }), [isMobile, netWorthBounds.max, netWorthBounds.min, netWorthCount, netWorthSeries, netWorthValues])

  const stockAssets = assets.filter((asset) => asset.asset_type === 'Stock')
  const stockTotalValue = stockAssets.reduce((sum, asset) => sum + computeAssetValue(asset), 0)
  const stockTotalCost = stockAssets.reduce((sum, asset) => sum + computeCostBasis(asset), 0)
  const stockGainLoss = stockTotalValue - stockTotalCost
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

  if (!assetsLoaded) {
    return (
      <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6">
        <div className="bg-card shadow-card rounded-2xl p-6 md:p-7 border border-border/70">
          <p className="text-sm text-muted-foreground">Loading portfolio...</p>
        </div>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6">
        <motion.div
          {...fadeUp(0)}
          className="bg-card shadow-card rounded-2xl p-6 md:p-7 border border-border/70"
        >
          <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium">
            {firstName ? `${firstName}'s Workspace` : 'Workspace'}
          </p>
          <h1 className="font-syne text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight">
            Add your first asset to get started.
          </h1>
          <p className="mt-4 text-sm md:text-base text-muted-foreground max-w-2xl">
            Portfolio and Charts unlock after your first asset is added. Use the command button to record a position.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-5 pb-6 md:px-6 md:pt-6 space-y-3">
      {/* TOP GRID: Net Worth Hero + Allocation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {/* NET WORTH HERO */}
        <motion.div
          {...fadeUp(0)}
          className="md:col-span-2 bg-card shadow-card rounded-2xl p-5 md:p-6 relative overflow-hidden"
        >
          {/* Ambient glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-8 left-1/4 w-72 h-36 bg-brand-subtle rounded-full blur-3xl" />
          </div>

          <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-3 font-medium relative">
            {firstName ? `${firstName}'s Net Worth` : 'Net Worth'}
          </p>

          <div className="mb-4 relative">
            <p
              ref={heroRef}
              className="text-[2.6rem] md:text-[3.1rem] font-bold tabular-nums tracking-tight leading-none font-syne"
            >
              {fmtCurrency(totalValue)}
            </p>
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
        </motion.div>

        {/* ALLOCATION */}
        <motion.div
          {...fadeUp(0.06)}
          className="bg-card shadow-card rounded-2xl p-5 md:p-6"
        >
          <p className="text-muted-foreground text-[10px] uppercase tracking-[0.15em] mb-4 font-medium">
            Allocation
          </p>

          {typeEntries.length === 0 ? (
            <p className="text-muted-foreground text-xs mt-2">No assets yet</p>
          ) : (
            <div className="space-y-3.5">
              {typeEntries.map(({ name, value, pct }, i) => {
                const color = TYPE_COLORS[name] ?? `hsl(${(i * 67 + 190) % 360}, 65%, 55%)`
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
      </div>

      {/* STATS ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        <motion.div {...fadeUp(0.1)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            {stockIsGain
              ? <TrendingUp size={11} className="text-gain" />
              : <TrendingDown size={11} className="text-loss" />}
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">P&L</p>
          </div>
          <p className={`text-lg font-bold tabular-nums leading-tight font-syne ${stockIsGain ? 'text-gain' : 'text-loss'}`}>
            {stockIsGain ? '+' : ''}{fmtCurrency(stockGainLoss)}
          </p>
          <p className={`text-[10px] tabular-nums mt-0.5 ${stockIsGain ? 'text-gain' : 'text-loss'}`}>
            {stockIsGain ? '+' : ''}{stockGainLossPercent.toFixed(2)}%
          </p>
        </motion.div>

        <motion.div {...fadeUp(0.13)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            <TrendingUp size={11} className="text-gain" />
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Best Performer</p>
          </div>
          <p className="text-sm font-semibold truncate">{bestAsset?.name ?? '—'}</p>
          {bestAsset && (
            <p className={`text-[10px] tabular-nums mt-0.5 ${bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}`}>
              {bestAssetGain >= 0 ? '+' : ''}{bestAssetGainPct.toFixed(2)}%
            </p>
          )}
        </motion.div>

        <motion.div {...fadeUp(0.16)} className="bg-card shadow-card rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2.5">
            <p className="text-muted-foreground text-[9px] uppercase tracking-[0.12em]">Largest Holding</p>
          </div>
          <p className="text-sm font-semibold truncate">{largestAsset?.name ?? '—'}</p>
          {largestAsset && (
            <>
              <p className="text-[10px] tabular-nums text-muted-foreground mt-0.5">{fmtCurrency(largestValue)}</p>
              <p className="text-[10px] tabular-nums text-muted-foreground">{largestPct.toFixed(1)}% of portfolio</p>
            </>
          )}
        </motion.div>

      </div>
    </div>
  )
}
