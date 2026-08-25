import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { PieChart, Landmark, Layers, TrendingUp, TrendingDown, Scale, BarChart3, CalendarClock, Sparkles } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { CardEyebrow } from '@/components/CardEyebrow'
import { Skeleton } from '@/components/ui/skeleton'
import { revealUp } from '@/lib/motionPresets'
import { colorForAssetType } from '@/lib/typeColors'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { useAppTheme } from '@/hooks/useAppTheme'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  computeCostVsValue,
  computeRsuVesting,
  computeThemeDistribution,
} from '@/lib/charts'

type Subtype = 'Market' | 'ESPP' | 'RSU'
const ALL_SUBTYPES: Subtype[] = ['Market', 'ESPP', 'RSU']

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6']
const GAIN_COLOR = 'hsl(158, 64%, 52%)'
const LOSS_COLOR = 'hsl(0, 84%, 60%)'
const MUTED_COLOR = 'hsl(224, 13%, 25%)'
const GRID_COLOR = 'hsl(224,13%,16%)'
const AXIS_COLOR = 'hsl(215,14%,55%)'
const TEXT_COLOR = 'hsl(215,20%,96%)'
const TOOLTIP_BG = 'hsl(224,13%,9%)'
// The donut's center-hole value sits directly on the chart's own
// (transparent) background — i.e. the card behind it — unlike TEXT_COLOR
// above, which is always paired with the always-dark TOOLTIP_BG and so
// stays legible in both themes without changing. This one has to flip:
// near-white TEXT_COLOR on a light-mode card was invisible. Matches
// index.css's --foreground light value.
const TEXT_COLOR_LIGHT = 'hsl(222,22%,10%)'
// Faint alternating band behind each row of a horizontal bar list, so a
// long list of positions (P&L, Cost vs Value, RSU vesting) stays easy to
// scan row-to-row instead of reading as one undifferentiated block.
const ZEBRA_COLORS = ['transparent', 'rgba(255,255,255,0.025)']

// Card shell shared with Home's bento grid — same background, corner
// radius, padding, and hover lift — so Charts reads as the same page
// system instead of its own component library.
const CARD_CLASS = 'bg-card shadow-card rounded-2xl p-5'
const CARD_HOVER = { y: -2, transition: { duration: 0.15, delay: 0 } }

const tooltipBase = {
  backgroundColor: TOOLTIP_BG,
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  textStyle: { color: TEXT_COLOR, fontSize: 12 },
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(n)
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(Math.round(n))
}

function fmtCompact(n: number) {
  return `${n < 0 ? '-' : ''}$${fmtShort(Math.abs(n))}`
}

function donutOption(
  data: { name: string; value: number; color: string }[],
  centerLabel: { label: string; value: string } | undefined,
  hideValues: boolean,
  centerTextColor: string,
): EChartsOption {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      show: !hideValues,
      ...tooltipBase,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; percent: number }
        return `${p.name}<br/>${fmt(Number(p.value))} (${Math.round(Number(p.percent))}%)`
      },
    },
    // Total shown in the donut's hole — a donut with no center content
    // otherwise wastes its own negative space; this puts the one number a
    // glance at the card most wants (the total it's a breakdown of) right
    // where the eye already lands.
    graphic: centerLabel
      ? {
          elements: [
            {
              type: 'text',
              left: 'center',
              top: 'center',
              style: {
                text: `{value|${centerLabel.value}}\n{label|${centerLabel.label}}`,
                align: 'center',
                rich: {
                  value: { fontSize: 16, fontWeight: 700, fill: centerTextColor, lineHeight: 20 },
                  label: { fontSize: 9, fill: AXIS_COLOR, lineHeight: 14 },
                },
              },
            },
          ],
        }
      : undefined,
    series: [
      {
        type: 'pie',
        radius: ['54%', '82%'],
        label: { show: false },
        labelLine: { show: false },
        avoidLabelOverlap: true,
        itemStyle: {
          borderColor: GRID_COLOR,
          borderWidth: 2,
        },
        // focus: 'self' dims every other slice when one is highlighted
        // (hover, or the legend below dispatching a highlight action) —
        // native ECharts behavior, no custom state machine needed.
        emphasis: {
          focus: 'self',
          scale: true,
          scaleSize: 6,
        },
        blur: {
          itemStyle: { opacity: 0.35 },
        },
        data: data.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.color },
        })),
      },
    ],
  }
}

/**
 * Donut chart + its legend, wired together in both directions: hovering a
 * legend swatch highlights the matching slice (and dims the rest via the
 * emphasis/blur config on the series), and hovering a slice highlights the
 * matching legend row. Centralized here since three charts on this page
 * share this exact pattern.
 */
function DonutWithLegend({
  option,
  colorData,
  height,
  emptyLabel,
  hideValues,
}: {
  option: EChartsOption
  colorData: { name: string; value: number; color: string }[]
  height: number
  emptyLabel: string
  hideValues: boolean
}) {
  const chartRef = useRef<ReactECharts | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const highlightSlice = useCallback((name: string) => {
    setHovered(name)
    chartRef.current?.getEchartsInstance().dispatchAction({ type: 'highlight', seriesIndex: 0, name })
  }, [])
  const downplaySlice = useCallback((name: string) => {
    setHovered((h) => (h === name ? null : h))
    chartRef.current?.getEchartsInstance().dispatchAction({ type: 'downplay', seriesIndex: 0, name })
  }, [])

  if (colorData.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">{emptyLabel}</p>
  }

  return (
    <>
      <div className={hiddenValueClass(hideValues)}>
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ width: '100%', height }}
          notMerge
          opts={{ renderer: 'svg' }}
          onEvents={{
            mouseover: (params: { componentType?: string; name?: string }) => {
              if (params.componentType === 'series' && params.name) setHovered(params.name)
            },
            mouseout: () => setHovered(null),
          }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {colorData.map((slice) => (
          <button
            type="button"
            key={slice.name}
            onMouseEnter={() => highlightSlice(slice.name)}
            onMouseLeave={() => downplaySlice(slice.name)}
            className={`flex items-center gap-1.5 text-xs rounded px-1 -mx-1 py-0.5 transition-colors ${
              hovered === slice.name ? 'bg-muted/60' : 'hover:bg-muted/30'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ background: slice.color }} />
            <span className={hovered === slice.name ? 'text-foreground font-medium' : 'text-muted-foreground'}>
              {slice.name}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

export default function Charts() {
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [activeSubtypes, setActiveSubtypes] = useState<Set<Subtype>>(new Set(ALL_SUBTYPES))
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [includeCashInThemeDistribution, setIncludeCashInThemeDistribution] = useState(false)
  const [hideValues] = useHideValues()
  const appTheme = useAppTheme()
  const centerTextColor = appTheme === 'light' ? TEXT_COLOR_LIGHT : TEXT_COLOR

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

  function toggleSubtype(s: Subtype) {
    setActiveSubtypes((prev) => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  const allocationData = groupByAssetType(assets, activeSubtypes)
  const allocationTotal = allocationData.reduce((sum, g) => sum + g.value, 0)
  const allocationColorData = allocationData.map((group) => ({
    name: group.type,
    value: group.value,
    // Same asset_type → color mapping Home's allocation card and Portfolio's
    // tiles use, so "Stock" (etc.) means the same swatch everywhere.
    color: colorForAssetType(group.type),
  }))
  const locationData = groupByLocation(assets)
  const locationTotal = locationData.reduce((sum, g) => sum + g.value, 0)
  const locationColorData = locationData.map((group, index) => ({
    name: group.name,
    value: group.value,
    color: PALETTE[index % PALETTE.length],
  }))
  const pnlData = computeUnrealizedPnLByPosition(assets)
  const totalPnl = pnlData.reduce((sum, p) => sum + p.gain, 0)
  const { shortTerm, longTerm } = computeCapitalGainsExposure(assets)
  const cvvData = computeCostVsValue(assets)
  const rsuData = computeRsuVesting(assets)
  const themeDistributionData = computeThemeDistribution(assets, includeCashInThemeDistribution)
  const themeDistributionTotal = themeDistributionData.reduce((sum, g) => sum + g.value, 0)
  const themeDistributionColorData = themeDistributionData.map((group, index) => ({
    name: group.name,
    value: group.value,
    color: PALETTE[index % PALETTE.length],
  }))
  const themeDistributionOption = useMemo<EChartsOption>(
    () => donutOption(themeDistributionColorData, { label: 'Total', value: fmtCompact(themeDistributionTotal) }, hideValues, centerTextColor),
    [themeDistributionColorData, themeDistributionTotal, hideValues, centerTextColor],
  )
  const allocationOption = useMemo<EChartsOption>(
    () => donutOption(allocationColorData, { label: 'Total', value: fmtCompact(allocationTotal) }, hideValues, centerTextColor),
    [allocationColorData, allocationTotal, hideValues, centerTextColor],
  )

  const locationOption = useMemo<EChartsOption>(
    () => donutOption(locationColorData, { label: 'Total', value: fmtCompact(locationTotal) }, hideValues, centerTextColor),
    [locationColorData, locationTotal, hideValues, centerTextColor],
  )

  const pnlOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      show: !hideValues,
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; value: number }>
        if (!rows.length) return ''
        return `${rows[0].axisValue}<br/>${fmt(Number(rows[0].value))}`
      },
    },
    grid: { left: 120, right: 48, top: 6, bottom: 6 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      inverse: true,
      data: pnlData.map((point) => point.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS_COLOR,
        fontSize: 11,
        width: 108,
        overflow: 'truncate',
      },
      splitArea: { show: true, areaStyle: { color: ZEBRA_COLORS } },
    },
    series: [
      {
        type: 'bar',
        data: pnlData.map((point) => ({
          value: point.gain,
          itemStyle: {
            color: point.gain >= 0 ? GAIN_COLOR : LOSS_COLOR,
            // Round the end of the bar farthest from the zero baseline —
            // for a negative bar (extending left) that's the left edge, the
            // mirror image of the positive case — otherwise the rounded
            // corner sits at the baseline instead of the tip.
            borderRadius: point.gain >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          // Likewise put the value label beyond the bar's actual tip, not
          // always to the right — for a negative bar the tip is on the left.
          label: { position: point.gain >= 0 ? 'right' : 'left' },
        })),
        barWidth: 20,
        label: {
          show: true,
          color: AXIS_COLOR,
          fontSize: 11,
          formatter: (params) => fmt(Number(params.value)),
        },
      },
    ],
  }), [pnlData, hideValues])

  const capitalGainsData = useMemo(
    () => [
      { label: 'Short-Term', value: shortTerm },
      { label: 'Long-Term', value: longTerm },
    ],
    [shortTerm, longTerm],
  )

  const capitalGainsAxisBounds = useMemo(() => {
    const values = capitalGainsData.map((point) => Number(point.value))
    const max = Math.max(0, ...values)
    const min = Math.min(0, ...values)
    return {
      max: max > 0 ? max * 1.15 : 0,
      min: min < 0 ? min * 1.15 : 0,
    }
  }, [capitalGainsData])

  const capitalGainsOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    // trigger: 'item' (not 'axis') deliberately — an axis-shadow pointer
    // draws a rectangle spanning the whole plot's height regardless of
    // which bar you're over, which for two bars this different in height
    // reads as a hover box that doesn't match (fully "cover") the shorter
    // one. Item trigger + the emphasis glow below hug the bar's own shape
    // instead.
    tooltip: {
      show: !hideValues,
      ...tooltipBase,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number }
        return `${p.name}<br/>${fmt(Number(p.value))}`
      },
    },
    grid: { left: 8, right: 16, top: 28, bottom: 16 },
    xAxis: {
      type: 'category',
      data: capitalGainsData.map((point) => point.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: AXIS_COLOR, fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      show: false,
      min: capitalGainsAxisBounds.min,
      max: capitalGainsAxisBounds.max,
    },
    series: [
      {
        type: 'bar',
        data: capitalGainsData.map((point) => ({
          value: point.value,
          itemStyle: {
            color: point.value >= 0 ? GAIN_COLOR : LOSS_COLOR,
            // Round the end of the bar farthest from the zero baseline, not
            // always the top — otherwise negative bars round their corner
            // at the baseline instead of at the tip, which reads as
            // misaligned against the positive bar sharing that baseline.
            borderRadius: point.value >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
          },
          // Put the label beyond the bar's tip — for a negative bar that's
          // below it, not above (the 'top' side of its bounding box sits at
          // the shared baseline, not near the value it's labeling).
          label: { position: point.value >= 0 ? 'top' : 'bottom' },
          // Glow that traces the bar's own (rounded) outline on hover —
          // the actual hover feedback, now that there's no axis shadow.
          emphasis: {
            itemStyle: {
              shadowBlur: 14,
              shadowColor: point.value >= 0 ? 'rgba(46,204,113,0.55)' : 'rgba(231,76,60,0.55)',
            },
          },
        })),
        barWidth: 34,
        label: {
          show: true,
          color: AXIS_COLOR,
          fontSize: 11,
          formatter: (params) => fmt(Number(params.value)),
        },
        // Zero reference line, pinned to the actual data value (not an
        // auto-computed tick) — the axis itself is hidden, so without this
        // there's nothing marking where the two bars actually meet.
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: GRID_COLOR, type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  }), [capitalGainsAxisBounds.max, capitalGainsAxisBounds.min, capitalGainsData, hideValues])

  const cvvOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      show: !hideValues,
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; seriesName: string; value: number }>
        if (!rows.length) return ''
        return `${rows[0].axisValue}<br/>${rows.map((row) => `${row.seriesName}: ${fmt(Number(row.value))}`).join('<br/>')}`
      },
    },
    legend: { show: false },
    grid: { left: 120, right: 48, top: 6, bottom: 6 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: cvvData.map((point) => point.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS_COLOR,
        fontSize: 11,
        width: 108,
        overflow: 'truncate',
      },
      splitArea: { show: true, areaStyle: { color: ZEBRA_COLORS } },
    },
    series: [
      {
        name: 'Cost Basis',
        type: 'bar',
        data: cvvData.map((point) => point.costBasis),
        barWidth: 14,
        itemStyle: { color: MUTED_COLOR, borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          color: AXIS_COLOR,
          fontSize: 10,
          formatter: (params) => fmtShort(Number(params.value)),
        },
      },
      {
        name: 'Current Value',
        type: 'bar',
        data: cvvData.map((point) => point.currentValue),
        barWidth: 14,
        itemStyle: { color: GAIN_COLOR, borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          color: AXIS_COLOR,
          fontSize: 10,
          formatter: (params) => fmtShort(Number(params.value)),
        },
      },
    ],
  }), [cvvData, hideValues])

  const rsuOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; seriesName: string; value: number; dataIndex: number }>
        if (!rows.length) return ''
        const idx = rows[0].dataIndex
        const row = rsuData[idx]
        const pct = row ? Math.round((row.vestedShares / row.totalShares) * 100) : 0
        return `${rows[0].axisValue}<br/>${rows.map((r) => `${r.seriesName}: ${r.value}`).join('<br/>')}<br/>Vested: ${pct}%`
      },
    },
    legend: { show: false },
    grid: { left: 140, right: 48, top: 6, bottom: 6 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: rsuData.map((point) => point.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS_COLOR,
        fontSize: 11,
        width: 128,
        overflow: 'truncate',
      },
      splitArea: { show: true, areaStyle: { color: ZEBRA_COLORS } },
    },
    series: [
      {
        name: 'Vested',
        type: 'bar',
        stack: 'vest',
        data: rsuData.map((point) => ({
          value: point.vestedShares,
          itemStyle: {
            color: GAIN_COLOR,
            // Vested is normally the left segment of the stack, so its own
            // right edge is a mid-stack seam, not the bar's actual tip —
            // except at 100% vested, where Unvested has zero width and
            // Vested becomes the whole (and therefore rounded) bar.
            borderRadius: point.unvestedShares === 0 ? [0, 4, 4, 0] : 0,
          },
        })),
        barWidth: 18,
      },
      {
        name: 'Unvested',
        type: 'bar',
        stack: 'vest',
        data: rsuData.map((point) => ({
          value: point.unvestedShares,
          itemStyle: {
            color: MUTED_COLOR,
            borderRadius: point.unvestedShares > 0 ? [0, 4, 4, 0] : 0,
          },
        })),
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          color: AXIS_COLOR,
          fontSize: 11,
          formatter: (params) => {
            const row = rsuData[params.dataIndex]
            if (!row || row.totalShares <= 0) return ''
            return `${Math.round((row.vestedShares / row.totalShares) * 100)}%`
          },
        },
      },
    ],
  }), [rsuData])

  if (!assetsLoaded) {
    return (
      <div className="px-4 pt-5 pb-24 md:px-6 md:pt-6 space-y-3">
        <Skeleton className="h-6 w-24" />
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`md:col-span-3 ${CARD_CLASS} space-y-4`}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-[220px] w-full rounded-xl" />
            </div>
          ))}
          {[0, 1, 2].map((i) => (
            <div key={`row-${i}`} className={`md:col-span-6 ${CARD_CLASS} space-y-4`}>
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-[200px] w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="px-4 pt-5 pb-24 md:px-6 md:pt-6">
        <motion.div
          {...revealUp(0)}
          className={`${CARD_CLASS} p-6 md:p-7 relative overflow-hidden text-center`}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 w-72 h-36 bg-brand-subtle rounded-full blur-3xl" />
          </div>
          <div className="relative mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle">
            <Sparkles size={18} className="text-primary" aria-hidden="true" />
          </div>
          <p className="relative font-syne text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Add an asset first.
          </p>
          <p className="relative mt-2 text-sm text-muted-foreground">
            Charts become available after your first asset is added.
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="px-4 pt-5 pb-24 md:px-6 md:pt-6 space-y-3">

      {/* HEADER — same icon-badge + font-syne treatment as Home's greeting row */}
      <motion.div {...revealUp(0)} className="flex items-center gap-2.5 px-1">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-subtle">
          <BarChart3 size={16} className="text-primary" aria-hidden="true" />
        </div>
        <p className="font-syne text-lg md:text-xl font-bold text-foreground tracking-tight">Charts</p>
      </motion.div>

      {/* Bento grid — same 6-column system as Home, so cards that don't need
          the full page width (the three donuts, capital gains exposure)
          sit two-up instead of stretching edge to edge. The per-position
          bar lists below stay full width since their row count is
          data-driven and their labels need the room. */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">

        {/* PORTFOLIO ALLOCATION */}
        <motion.div
          {...revealUp(0)}
          whileHover={CARD_HOVER}
          className={`md:col-span-3 ${CARD_CLASS}`}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <CardEyebrow icon={PieChart}>Portfolio Allocation</CardEyebrow>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 flex-shrink-0">
              {ALL_SUBTYPES.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSubtype(s)}
                  className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                    activeSubtypes.has(s) ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <DonutWithLegend option={allocationOption} colorData={allocationColorData} height={220} emptyLabel="No data" hideValues={hideValues} />
        </motion.div>

        {/* BY ACCOUNT */}
        <motion.div
          {...revealUp(0.03)}
          whileHover={CARD_HOVER}
          className={`md:col-span-3 ${CARD_CLASS}`}
        >
          <div className="mb-3">
            <CardEyebrow icon={Landmark}>By Account</CardEyebrow>
          </div>
          <DonutWithLegend option={locationOption} colorData={locationColorData} height={220} emptyLabel="No data" hideValues={hideValues} />
        </motion.div>

        {/* STOCK DISTRIBUTION BY THEME */}
        <motion.div
          {...revealUp(0.06)}
          whileHover={CARD_HOVER}
          className={`md:col-span-3 ${CARD_CLASS}`}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <CardEyebrow icon={Layers}>Stock Distribution by Theme</CardEyebrow>
            <button
              type="button"
              onClick={() => setIncludeCashInThemeDistribution((prev) => !prev)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors flex-shrink-0 ${
                includeCashInThemeDistribution
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              {includeCashInThemeDistribution ? 'Cash Included' : 'Include Cash'}
            </button>
          </div>
          <DonutWithLegend
            option={themeDistributionOption}
            colorData={themeDistributionColorData}
            height={220}
            emptyLabel="No themed stock data yet"
            hideValues={hideValues}
          />
        </motion.div>

        {/* CAPITAL GAINS EXPOSURE — just two bars, so it shares a row with
            the donuts above rather than stretching full width. */}
        {(shortTerm !== 0 || longTerm !== 0) && (
          <motion.div
            {...revealUp(0.09)}
            whileHover={CARD_HOVER}
            className={`md:col-span-3 ${CARD_CLASS}`}
          >
            <div className="mb-3">
              <CardEyebrow icon={Scale}>Capital Gains Exposure</CardEyebrow>
            </div>
            <div className={hiddenValueClass(hideValues)}>
              <ReactECharts option={capitalGainsOption} style={{ width: '100%', height: 220 }} notMerge opts={{ renderer: 'svg' }} />
            </div>
          </motion.div>
        )}

        {/* UNREALIZED P&L BY POSITION */}
        {pnlData.length > 0 && (
          <motion.div
            {...revealUp(0.12)}
            whileHover={CARD_HOVER}
            className={`md:col-span-6 ${CARD_CLASS}`}
          >
            <div className="mb-3">
              <CardEyebrow icon={totalPnl >= 0 ? TrendingUp : TrendingDown} className={totalPnl >= 0 ? 'text-gain' : 'text-loss'}>
                Unrealized P&amp;L by Position
              </CardEyebrow>
            </div>
            <div className={hiddenValueClass(hideValues)}>
              <ReactECharts
                option={pnlOption}
                style={{ width: '100%', height: Math.max(180, pnlData.length * 44) }}
                notMerge
                opts={{ renderer: 'svg' }}
              />
            </div>
          </motion.div>
        )}

        {/* COST BASIS VS CURRENT VALUE */}
        {cvvData.length > 0 && (
          <motion.div
            {...revealUp(0.15)}
            whileHover={CARD_HOVER}
            className={`md:col-span-6 ${CARD_CLASS}`}
          >
            <div className="mb-3">
              <CardEyebrow icon={BarChart3}>Cost Basis vs Current Value</CardEyebrow>
            </div>
            <div className={hiddenValueClass(hideValues)}>
              <ReactECharts
                option={cvvOption}
                style={{ width: '100%', height: Math.max(180, cvvData.length * 60) }}
                notMerge
                opts={{ renderer: 'svg' }}
              />
            </div>
          </motion.div>
        )}

        {/* RSU VESTING PROGRESS */}
        {rsuData.length > 0 && (
          <motion.div
            {...revealUp(0.18)}
            whileHover={CARD_HOVER}
            className={`md:col-span-6 ${CARD_CLASS}`}
          >
            <div className="mb-3">
              <CardEyebrow icon={CalendarClock}>RSU Vesting Progress</CardEyebrow>
            </div>
            <ReactECharts
              option={rsuOption}
              style={{ width: '100%', height: Math.max(180, rsuData.length * 52) }}
              notMerge
              opts={{ renderer: 'svg' }}
            />
          </motion.div>
        )}
      </div>
    </div>
    </>
  )
}
