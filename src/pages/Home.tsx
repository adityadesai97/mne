// src/pages/Home.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { TrendingUp, TrendingDown, Lightbulb, Wallet, PieChart, Activity, Crown, Sparkles } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { getSnapshots } from '@/lib/db/snapshots'
import { computeCostBasis, computeUnrealizedGain, computeTotalNetWorth, computeAssetValue, computeDailyChange, isTickerAsset } from '@/lib/portfolio'
import { getSupabaseClient } from '@/lib/supabase'
import { refreshAllPrices } from '@/lib/db/tickers'
import { refreshPricesOncePerLoad, PRICES_REFRESHED_AT_KEY } from '@/lib/priceRefresh'
import { config } from '@/store/config'
import { usePullToRefresh } from '@/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator'
import { CardEyebrow } from '@/components/CardEyebrow'
import { NetWorthChart } from '@/components/NetWorthChart'
import { Delta, PageHead, SegmentedControl, Stat } from '@/components/mne'
import { showAppAlert } from '@/lib/appAlerts'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { PortfolioPulseCarousel } from '@/components/PortfolioPulseCarousel'

const HOME_CHART_RANGE_KEY = 'mne_home_chart_range'
const HOME_CHART_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const
type HomeChartRange = typeof HOME_CHART_RANGES[number]

function getGreeting(): { text: string } {
  const hour = new Date().getHours()
  if (hour < 5) return { text: 'Good night' }
  if (hour < 12) return { text: 'Good morning' }
  if (hour < 17) return { text: 'Good afternoon' }
  if (hour < 21) return { text: 'Good evening' }
  return { text: 'Good night' }
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

// Counts to the new value in 180ms from wherever it currently is (not from
// zero), with no scale pop; jumps straight there for reduced-motion users.
function useAnimatedNumber(target: number, ref: React.RefObject<HTMLElement | null>, format = fmtCurrency) {
  const fromRef = useRef(target)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || fromRef.current === target) {
      node.textContent = format(target)
      fromRef.current = target
      return
    }
    const controls = animate(fromRef.current, target, {
      duration: 0.18,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (v) => { node.textContent = format(v) },
      onComplete: () => { fromRef.current = target },
    })
    return () => { controls.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const heroRef = useRef<HTMLSpanElement>(null)
  const greeting = useMemo(() => getGreeting(), [])
  const [hideValues] = useHideValues()

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
    if (config.hasFinnhubKey) {
      try {
        await refreshAllPrices()
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

  // Sum each position's own gain/loss (the same figure shown on its Portfolio card)
  // rather than re-deriving from separately-summed totals — keeps this tile always
  // equal to the sum of the individual P/L numbers the user sees elsewhere.
  const stockAssets = assets.filter((asset) => isTickerAsset(asset))
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

  // Today's change: the sum of each stock position's (current price − last
  // close) move — the same computeDailyChange basis Portfolio Pulse uses
  // (via computeMovers), so the hero and the explanation card always agree.
  // Deliberately NOT derived from the net worth snapshot series anymore —
  // that compared today's live net worth to whatever net worth happened to
  // be recorded the last time the app was open yesterday (recordDailySnapshot
  // overwrites "today"'s row on every visit), which could be any point in
  // yesterday's session rather than its actual close, and silently understated
  // or overstated the real move depending on when that was. Drives both the
  // ambient glow's color and the daily change figure under the hero number.
  const todayChange = dailyMovers.reduce((sum, m) => sum + m.dollarChange, 0)
  const todayChangePercent = totalValue > 0 ? (todayChange / totalValue) * 100 : 0
  const hasMood = dailyMovers.length > 0 && todayChange !== 0

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

  const heroGreeting = `${greeting.text}${firstName ? `, ${firstName}` : ''}`
  const isUpdating = isRefreshingPrices || refreshing

  if (!assetsLoaded) {
    return (
      <div className="mne-main">
        <PageHead title={heroGreeting} />
        <div className="mne-bento" aria-busy="true" aria-label="Loading">
          <section className="mne-card is-hero s4" style={{ display: 'grid', gap: 12 }}>
            <div className="mne-skel is-pill" style={{ height: 12, width: 90 }} />
            <div className="mne-skel" style={{ height: 52, width: '60%' }} />
            <div className="mne-skel is-pill" style={{ height: 26, width: 130 }} />
            <div className="mne-skel" style={{ height: 90 }} />
          </section>
          <section className="mne-card s2" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="mne-skel is-pill" style={{ height: 12, width: 80 }} />
            <div className="mne-skel is-pill" style={{ height: 14 }} />
            <div className="mne-skel" style={{ height: 20 }} />
            <div className="mne-skel" style={{ height: 20 }} />
          </section>
          <section className="mne-card s3"><div className="mne-skel" style={{ height: 80 }} /></section>
          <section className="mne-card s3"><div className="mne-skel" style={{ height: 80 }} /></section>
        </div>
      </div>
    )
  }

  if (assetsLoaded && assets.length === 0) {
    return (
      <div className="mne-main">
        <PageHead title={heroGreeting} />
        <section className="mne-card is-hero">
          <div className="mne-empty">
            <span className="ico"><Sparkles aria-hidden="true" /></span>
            <h3>Add your first asset to get started.</h3>
            <p>Portfolio and Charts unlock after your first asset is added. Use the command button to record a position.</p>
          </div>
        </section>
      </div>
    )
  }

  // Rows below the hero/allocation/pulse rows pair up in halves; without any
  // daily movers the remaining three cards share the row in thirds instead.
  const hasMovers = dailyMovers.length > 0
  const rest = hasMovers ? 's3' : 's2'
  const rangeLabel = homeChartRange === 'ALL' ? 'all time' : homeChartRange

  return (
    <>
    <PullToRefreshIndicator pullY={pullY} refreshing={refreshing} />
    <div className="mne-main">
      <PageHead title={heroGreeting}>
        <button
          type="button"
          className="mne-btn is-ghost is-sm"
          onClick={handleManualRefresh}
          disabled={isRefreshingPrices}
          aria-label="Refresh prices"
        >
          {isRefreshingPrices ? 'Updating…' : 'Refresh prices'}
        </button>
      </PageHead>

      <div className="mne-bento">

        {/* NET WORTH HERO */}
        <section className="mne-card is-hero s4">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <CardEyebrow icon={Wallet}>Net worth</CardEyebrow>
            <span className="mne-live"><i />live</span>
          </div>

          <div>
            <span
              ref={heroRef}
              className={`mne-hero-figure ${hiddenValueClass(hideValues, '', 'lg')}`}
            >
              {fmtCurrency(totalValue)}
            </span>
            {isUpdating && <div className="mne-progress" style={{ width: 160, height: 6 }} role="status" aria-label="Updating prices" />}
          </div>

          {hasMood && Math.abs(todayChange) >= 1 && (
            <div className={hiddenValueClass(hideValues)} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="mne-chip"><Delta value={todayChangePercent} suffix="today" /></span>
              <span className="mne-muted mne-num">{todayChange >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(todayChange))}</span>
            </div>
          )}

          {/* The line stays visible in privacy mode (an earlier decision: the
              trend alone doesn't read as a dollar figure); NetWorthChart turns
              the scrub tooltip, which prints exact values, off. */}
          <div style={{ marginTop: 14 }}>
            <NetWorthChart
              series={netWorthSeries}
              height={isMobile ? 110 : 150}
              hideValues={hideValues}
              label={`Net worth over ${rangeLabel}`}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <SegmentedControl
              label="Chart range"
              value={homeChartRange}
              options={HOME_CHART_RANGES}
              onChange={handleRangeChange}
            />
          </div>

          <div className="mne-stats" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--mne-line)' }}>
            <Stat label="Positions" value={assets.length} />
            <Stat label="Asset types" value={uniqueAssetTypes} />
          </div>

          {/* Rotating insight ticker */}
          {insights.length > 0 && (
            <div className="mne-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, lineHeight: '16px', overflow: 'hidden' }}>
              <Lightbulb size={14} style={{ flex: 'none', color: 'var(--mne-accent)' }} aria-hidden="true" />
              <AnimatePresence mode="wait">
                <motion.span
                  key={insights[insightIndex % insights.length]}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                  className="truncate"
                >
                  {insights[insightIndex % insights.length]}
                </motion.span>
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* ALLOCATION */}
        <section className="mne-card s2">
          <CardEyebrow icon={PieChart}>Allocation</CardEyebrow>
          {typeEntries.length === 0 ? (
            <p className="mne-muted" style={{ marginTop: 14 }}>No assets yet</p>
          ) : (
            <>
              <div className="mne-stack" style={{ marginTop: 14 }} role="img" aria-label="Allocation by asset type">
                {typeEntries.map(({ name, pct }, i) => (
                  <span key={name} style={{ width: `${pct}%`, background: `var(--mne-chart-${(i % 5) + 1})` }} />
                ))}
              </div>
              <div className="mne-breakdown">
                {typeEntries.map(({ name, value, pct }, i) => (
                  <div key={name}>
                    <i style={{ background: `var(--mne-chart-${(i % 5) + 1})` }} />
                    <span>{name}</span>
                    <span className="mne-muted">{pct.toFixed(1)}%</span>
                    <b className={`mne-num ${hiddenValueClass(hideValues)}`} style={{ fontWeight: 500 }}>{fmtCurrency(value)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* PORTFOLIO PULSE (renders nothing when there's no relevant insight) */}
        <PortfolioPulseCarousel assets={assets} netWorth={totalValue} />

        {/* DAILY MOVERS */}
        {hasMovers && (
          <section className="mne-card s3">
            <div className="flex items-center justify-between gap-2">
              <CardEyebrow icon={Activity}>Daily movers</CardEyebrow>
              <SegmentedControl
                label="Sort movers"
                value={moverSort}
                options={[{ value: 'percent', label: 'By %' }, { value: 'value', label: 'By value' }] as const}
                onChange={setMoverSort}
              />
            </div>
            <table className="mne-table is-compact" style={{ marginTop: 8 }}>
              <tbody>
                {sortedMovers.map((mover) => (
                  <tr key={mover.id}>
                    <td>
                      <Link to={`/portfolio/${mover.id}`} title={mover.name}>{mover.symbol}</Link>
                    </td>
                    <td className="r">
                      <span className={`mne-muted mne-num ${hiddenValueClass(hideValues)}`} style={{ marginRight: 10 }}>
                        {mover.dollarChange >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(mover.dollarChange))}
                      </span>
                      <Delta value={mover.percentChange} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* LARGEST HOLDING */}
        <section className={`mne-card ${rest}`}>
          <CardEyebrow icon={Crown} accent>Largest holding</CardEyebrow>
          {largestAsset ? (
            <Link to={`/portfolio/${largestAsset.id}`} className="block" style={{ marginTop: 10 }}>
              <Stat
                label={largestAsset.ticker?.symbol ?? largestAsset.name}
                value={<span className={hiddenValueClass(hideValues)}>{fmtCurrency(largestValue)}</span>}
                sub={`${largestPct.toFixed(0)}% of net worth`}
                subClassName="mne-muted"
              />
            </Link>
          ) : (
            <p className="mne-muted" style={{ marginTop: 10 }}>—</p>
          )}
        </section>

        {/* P&L */}
        <section className={`mne-card ${rest}`}>
          <CardEyebrow icon={stockIsGain ? TrendingUp : TrendingDown} className={stockIsGain ? 'text-gain' : 'text-loss'}>P&amp;L</CardEyebrow>
          <Stat
            className="mt-2.5"
            label="Unrealized, all stocks"
            value={<span className={`${stockIsGain ? 'mne-up' : 'mne-down'} ${hiddenValueClass(hideValues)}`}>{stockIsGain ? '+' : '−'}{fmtCurrency(Math.abs(stockGainLoss))}</span>}
            sub={<Delta value={stockGainLossPercent} />}
          />
        </section>

        {/* BEST PERFORMER */}
        <section className={`mne-card ${rest}`}>
          <CardEyebrow icon={bestAssetGain >= 0 ? TrendingUp : TrendingDown} className={bestAssetGain >= 0 ? 'text-gain' : 'text-loss'}>Best performer</CardEyebrow>
          {bestAsset ? (
            <Link to={`/portfolio/${bestAsset.id}`} className="block" style={{ marginTop: 10 }}>
              <Stat
                label={bestAsset.ticker?.symbol ?? bestAsset.name}
                value={<span className={`${bestAssetGain >= 0 ? 'mne-up' : 'mne-down'} ${hiddenValueClass(hideValues)}`}>{bestAssetGain >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(bestAssetGain))}</span>}
                sub={<Delta value={bestAssetGainPct} />}
              />
            </Link>
          ) : (
            <p className="mne-muted" style={{ marginTop: 10 }}>—</p>
          )}
        </section>

      </div>
    </div>
    </>
  )
}
