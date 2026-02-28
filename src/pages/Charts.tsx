import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { getAllAssets } from '@/lib/db/assets'
import { getSnapshots } from '@/lib/db/snapshots'
import { refreshAllPrices } from '@/lib/db/tickers'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
type NetWorthRange = '1M' | '3M' | '6M' | '1Y' | 'ALL'
const NET_WORTH_RANGES: NetWorthRange[] = ['1M', '3M', '6M', '1Y', 'ALL']

const PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6']
const GAIN_COLOR = 'hsl(158, 64%, 52%)'
const LOSS_COLOR = 'hsl(0, 84%, 60%)'
const MUTED_COLOR = 'hsl(224, 13%, 25%)'
const GRID_COLOR = 'hsl(224,13%,16%)'
const AXIS_COLOR = 'hsl(215,14%,55%)'
const TEXT_COLOR = 'hsl(215,20%,96%)'
const TOOLTIP_BG = 'hsl(224,13%,9%)'

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

function formatDateShort(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}

function formatDateCompact(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(parsed)
}

function donutOption(
  data: { name: string; value: number; color: string }[],
): EChartsOption {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipBase,
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; percent: number }
        return `${p.name}<br/>${fmt(Number(p.value))} (${Math.round(Number(p.percent))}%)`
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['50%', '82%'],
        label: { show: false },
        labelLine: { show: false },
        avoidLabelOverlap: true,
        itemStyle: {
          borderColor: GRID_COLOR,
          borderWidth: 2,
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

export default function Charts() {
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [activeSubtypes, setActiveSubtypes] = useState<Set<Subtype>>(new Set(ALL_SUBTYPES))
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const [netWorthRange, setNetWorthRange] = useState<NetWorthRange>('1Y')
  const [includeCashInThemeDistribution, setIncludeCashInThemeDistribution] = useState(false)

  useEffect(() => {
    getAllAssets()
      .then(setAssets)
      .catch(console.error)
      .finally(() => setAssetsLoaded(true))
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

  const handleRefresh = useCallback(async () => {
    if (config.finnhubApiKey) await refreshAllPrices(config.finnhubApiKey).catch(console.error)
    const [fresh] = await Promise.all([
      getAllAssets().catch(() => assets),
      getSnapshots().then(setSnapshots).catch(console.error),
    ])
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
  const allocationColorData = allocationData.map((group, index) => ({
    name: group.type,
    value: group.value,
    color: PALETTE[index % PALETTE.length],
  }))
  const locationData = groupByLocation(assets)
  const locationColorData = locationData.map((group, index) => ({
    name: group.name,
    value: group.value,
    color: PALETTE[index % PALETTE.length],
  }))
  const pnlData = computeUnrealizedPnLByPosition(assets)
  const { shortTerm, longTerm } = computeCapitalGainsExposure(assets)
  const cvvData = computeCostVsValue(assets)
  const rsuData = computeRsuVesting(assets)
  const themeDistributionData = computeThemeDistribution(assets, includeCashInThemeDistribution)
  const themeDistributionColorData = themeDistributionData.map((group, index) => ({
    name: group.name,
    value: group.value,
    color: PALETTE[index % PALETTE.length],
  }))
  const themeDistributionOption = useMemo<EChartsOption>(
    () => donutOption(themeDistributionColorData),
    [themeDistributionColorData],
  )
  const filteredSnapshots = useMemo(() => {
    if (snapshots.length <= 1 || netWorthRange === 'ALL') return snapshots
    const latest = snapshots[snapshots.length - 1]
    if (!latest?.date) return snapshots

    const endDate = new Date(`${latest.date}T00:00:00`)
    if (Number.isNaN(endDate.getTime())) return snapshots

    const startDate = new Date(endDate)
    if (netWorthRange === '1M') startDate.setMonth(startDate.getMonth() - 1)
    if (netWorthRange === '3M') startDate.setMonth(startDate.getMonth() - 3)
    if (netWorthRange === '6M') startDate.setMonth(startDate.getMonth() - 6)
    if (netWorthRange === '1Y') startDate.setFullYear(startDate.getFullYear() - 1)

    const filtered = snapshots.filter((point) => {
      if (!point?.date) return false
      const date = new Date(`${point.date}T00:00:00`)
      if (Number.isNaN(date.getTime())) return false
      return date >= startDate
    })

    if (filtered.length >= 2) return filtered
    return snapshots.slice(Math.max(0, snapshots.length - 2))
  }, [netWorthRange, snapshots])
  const netWorthValues = useMemo(() => filteredSnapshots.map((point) => Number(point.value)), [filteredSnapshots])
  const netWorthCount = netWorthValues.length
  const netWorthBounds = useMemo(() => {
    if (!netWorthValues.length) {
      return { min: 0, max: 0 }
    }

    const min = Math.min(...netWorthValues)
    const max = Math.max(...netWorthValues)
    const range = Math.max(max - min, Math.max(1, Math.abs(max) * 0.04))
    const pad = range * (netWorthCount <= 2 ? 0.4 : 0.2)

    return {
      min: min - pad,
      max: max + pad,
    }
  }, [netWorthCount, netWorthValues])

  const netWorthOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; value: number | [string, number] }>
        if (!rows.length) return ''
        const first = rows[0]
        const raw = first.value
        const value = Array.isArray(raw) ? Number(raw[1]) : Number(raw)
        return `${formatDateShort(first.axisValue)}<br/>${fmt(value)}`
      },
    },
    grid: {
      left: isMobile ? 14 : 12,
      right: isMobile ? 14 : 12,
      top: 12,
      bottom: isMobile ? 30 : 26,
      containLabel: false,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: filteredSnapshots.map((point) => point.date),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: AXIS_COLOR,
        fontSize: 10,
        margin: isMobile ? 8 : 10,
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
        symbol: netWorthCount <= 2 && isMobile ? 'circle' : 'none',
        symbolSize: 6,
        clip: true,
        lineStyle: { width: 2, color: 'hsl(217,91%,60%)' },
        areaStyle: { opacity: netWorthCount <= 2 ? 0.05 : 0.08, color: 'hsl(217,91%,60%)', origin: 'start' },
        data: netWorthValues,
      },
    ],
  }), [filteredSnapshots, isMobile, netWorthBounds.max, netWorthBounds.min, netWorthCount, netWorthValues])

  const allocationOption = useMemo<EChartsOption>(
    () => donutOption(allocationColorData),
    [allocationColorData],
  )

  const locationOption = useMemo<EChartsOption>(
    () => donutOption(locationColorData),
    [locationColorData],
  )

  const pnlOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
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
    },
    series: [
      {
        type: 'bar',
        data: pnlData.map((point) => ({
          value: point.gain,
          itemStyle: { color: point.gain >= 0 ? GAIN_COLOR : LOSS_COLOR },
        })),
        barWidth: 20,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          color: AXIS_COLOR,
          fontSize: 11,
          formatter: (params) => fmt(Number(params.value)),
        },
      },
    ],
  }), [pnlData])

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
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; value: number }>
        if (!rows.length) return ''
        return `${rows[0].axisValue}<br/>${fmt(Number(rows[0].value))}`
      },
    },
    grid: { left: 8, right: 16, top: 20, bottom: 16 },
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
          itemStyle: { color: point.value >= 0 ? GAIN_COLOR : LOSS_COLOR },
        })),
        barWidth: 34,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: AXIS_COLOR,
          fontSize: 11,
          formatter: (params) => fmt(Number(params.value)),
        },
      },
    ],
  }), [capitalGainsAxisBounds.max, capitalGainsAxisBounds.min, capitalGainsData])

  const cvvOption = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    tooltip: {
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
    },
    series: [
      {
        name: 'Cost Basis',
        type: 'bar',
        data: cvvData.map((point) => point.costBasis),
        barWidth: 14,
        itemStyle: { color: MUTED_COLOR },
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
  }), [cvvData])

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
    },
    series: [
      {
        name: 'Vested',
        type: 'bar',
        stack: 'vest',
        data: rsuData.map((point) => point.vestedShares),
        barWidth: 18,
        itemStyle: { color: GAIN_COLOR },
      },
      {
        name: 'Unvested',
        type: 'bar',
        stack: 'vest',
        data: rsuData.map((point) => point.unvestedShares),
        barWidth: 18,
        itemStyle: { color: MUTED_COLOR, borderRadius: [0, 4, 4, 0] },
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
      <div className="pt-6 pb-24 px-4 space-y-4">
        <h1 className="text-xl font-bold">Charts</h1>
        <p className="text-sm text-muted-foreground">Loading charts...</p>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="pt-6 pb-24 px-4 space-y-4">
        <h1 className="text-xl font-bold">Charts</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="font-syne text-2xl font-bold tracking-tight text-foreground">Add an asset first.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Charts become available after your first asset is added.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="pt-6 pb-24 px-4 space-y-4">
      <h1 className="text-xl font-bold">Charts</h1>

      {filteredSnapshots.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-sm text-muted-foreground">Net Worth Over Time</CardTitle>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {NET_WORTH_RANGES.map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setNetWorthRange(range)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      netWorthRange === range
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ReactECharts option={netWorthOption} style={{ width: '100%', height: 220 }} notMerge opts={{ renderer: 'svg' }} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Portfolio Allocation</CardTitle>
            <div className="flex gap-2 flex-wrap mt-1">
              {ALL_SUBTYPES.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => toggleSubtype(s)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    activeSubtypes.has(s)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-muted-foreground border-border'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {allocationData.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No data</p>
            ) : (
              <ReactECharts option={allocationOption} style={{ width: '100%', height: 220 }} notMerge opts={{ renderer: 'svg' }} />
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {allocationColorData.map((slice) => (
                <div key={slice.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: slice.color }} />
                  <span className="text-muted-foreground">{slice.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">By Account</CardTitle>
          </CardHeader>
          <CardContent>
            {locationData.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No data</p>
            ) : (
              <ReactECharts option={locationOption} style={{ width: '100%', height: 220 }} notMerge opts={{ renderer: 'svg' }} />
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {locationColorData.map((slice) => (
                <div key={slice.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: slice.color }} />
                  <span className="text-muted-foreground">{slice.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-sm text-muted-foreground">Stock Distribution by Theme</CardTitle>
            <button
              type="button"
              onClick={() => setIncludeCashInThemeDistribution((prev) => !prev)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                includeCashInThemeDistribution
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border'
              }`}
            >
              {includeCashInThemeDistribution ? 'Cash Included' : 'Include Cash'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {themeDistributionData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No themed stock data yet</p>
          ) : (
            <ReactECharts option={themeDistributionOption} style={{ width: '100%', height: 240 }} notMerge opts={{ renderer: 'svg' }} />
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {themeDistributionColorData.map((slice) => (
              <div key={slice.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: slice.color }} />
                <span className="text-muted-foreground">{slice.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {pnlData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unrealized P&amp;L by Position</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={pnlOption}
              style={{ width: '100%', height: Math.max(180, pnlData.length * 44) }}
              notMerge
              opts={{ renderer: 'svg' }}
            />
          </CardContent>
        </Card>
      )}

      {(shortTerm !== 0 || longTerm !== 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Capital Gains Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={capitalGainsOption} style={{ width: '100%', height: 160 }} notMerge opts={{ renderer: 'svg' }} />
          </CardContent>
        </Card>
      )}

      {cvvData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Cost Basis vs Current Value</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={cvvOption}
              style={{ width: '100%', height: Math.max(180, cvvData.length * 60) }}
              notMerge
              opts={{ renderer: 'svg' }}
            />
          </CardContent>
        </Card>
      )}

      {rsuData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">RSU Vesting Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={rsuOption}
              style={{ width: '100%', height: Math.max(180, rsuData.length * 52) }}
              notMerge
              opts={{ renderer: 'svg' }}
            />
          </CardContent>
        </Card>
      )}
    </div>
    </>
  )
}
