import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Masonry } from '@/components/mne/Masonry'
import { DashboardEditButton, DashboardGrid } from '@/components/mne/DashboardGrid'
import { useDashboardLayout } from '@/hooks/useDashboardLayout'
import type { CardDef } from '@/lib/dashboardLayout'
import { PieChart, Landmark, Layers, TrendingUp, Scale, BarChart3, CalendarClock } from 'lucide-react'
import { getAllAssets } from '@/lib/db/assets'
import { refreshPricesOncePerLoad } from '@/lib/priceRefresh'
import { getAllThemes } from '@/lib/db/themes'
import { useHideValues, hiddenValueClass } from '@/hooks/useHideValues'
import { Delta, Eyebrow, PageHead } from '@/components/mne'
import { Dropdown, MultiDropdown } from '@/components/mne/Dropdown'
import {
  StackBreakdown,
  TrackBars,
  DivergingBars,
  CostValueBars,
  ThemeTargetBars,
  RsuVestChart,
  capSegments,
} from '@/components/mne/charts'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  listCapitalGainsSymbols,
  computeCostVsValue,
  computeRsuVestTimeline,
  computeThemeDistribution,
} from '@/lib/charts'

/** Charts' cards in their default order and width; users can reorder, resize and hide them (see useDashboardLayout). */
const CHART_CARDS: readonly CardDef[] = [
  { id: 'allocation', label: 'Portfolio allocation', span: 1 },
  { id: 'by-account', label: 'By account', span: 1 },
  { id: 'pnl', label: 'Unrealized P&L', span: 2 },
  { id: 'theme-distribution', label: 'Stock distribution by theme', span: 1 },
  { id: 'capital-gains', label: 'Capital gains exposure', span: 1 },
  { id: 'cost-vs-value', label: 'Cost basis vs value', span: 2 },
  { id: 'rsu-vesting', label: 'RSU vesting progress', span: 2 },
]

type Subtype = 'Market' | 'ESPP' | 'RSU'
const ALL_SUBTYPES: Subtype[] = ['Market', 'ESPP', 'RSU']

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export default function Charts() {
  const [assets, setAssets] = useState<any[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [themeTargets, setThemeTargets] = useState<Record<string, number>>({})
  const [activeSubtypes, setActiveSubtypes] = useState<Set<Subtype>>(new Set(ALL_SUBTYPES))
  const [includeCashInThemeDistribution, setIncludeCashInThemeDistribution] = useState(false)
  const [gainsSymbol, setGainsSymbol] = useState('')
  const [hideValues] = useHideValues()
  const dash = useDashboardLayout('charts', CHART_CARDS)

  useEffect(() => {
    // Refresh prices first (once per page load) so the charts use current quotes.
    refreshPricesOncePerLoad()
      .then(() => getAllAssets())
      .then(setAssets)
      .catch(console.error)
      .finally(() => setAssetsLoaded(true))
    // Theme targets are optional extras for the theme chart; failing just hides the tick marks.
    getAllThemes()
      .then((themes) => {
        const next: Record<string, number> = {}
        for (const t of themes ?? []) {
          const target = Number((t as any).theme_targets?.[0]?.target_percentage)
          if (Number.isFinite(target)) next[(t as any).name] = target
        }
        setThemeTargets(next)
      })
      .catch(() => {})
  }, [])

  const allocation = useMemo(
    () => capSegments(groupByAssetType(assets, activeSubtypes).map((g) => ({ name: g.type, value: g.value }))),
    [assets, activeSubtypes],
  )
  const locations = useMemo(() => capSegments(groupByLocation(assets), 8), [assets])
  const pnlData = computeUnrealizedPnLByPosition(assets)
  const totalPnl = pnlData.reduce((sum, p) => sum + p.gain, 0)
  const gainsSymbols = listCapitalGainsSymbols(assets)
  // A refresh/delete can drop the selected ticker; fall back to "All".
  const activeGainsSymbol = gainsSymbols.includes(gainsSymbol) ? gainsSymbol : ''
  const { shortTerm, longTerm } = computeCapitalGainsExposure(assets, activeGainsSymbol || undefined)
  const cvvData = computeCostVsValue(assets)
  const rsuData = computeRsuVestTimeline(assets)
  const themeDistribution = computeThemeDistribution(assets, includeCashInThemeDistribution)

  if (!assetsLoaded) {
    return (
      <div className="mne-main" aria-busy="true">
        <PageHead title="Charts" />
        <Masonry>
          {[0, 1, 2, 3].map((i) => (
            <section key={i} className="mne-card">
              <div className="mne-skel" style={{ height: 14, width: 140 }} />
              <div className="mne-skel" style={{ height: 160, marginTop: 18 }} />
            </section>
          ))}
        </Masonry>
      </div>
    )
  }

  if (assets.length === 0) {
    return (
      <div className="mne-main">
        <PageHead title="Charts" />
        <section className="mne-card">
          <div className="mne-empty">
            <span className="ico">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-6" /></svg>
            </span>
            <h3>Add an asset first.</h3>
            <p>Charts become available after your first asset is added.</p>
          </div>
        </section>
      </div>
    )
  }

  const gainsGross = Math.abs(shortTerm) + Math.abs(longTerm)
  const signed = (n: number) => <Delta value={n} format={fmt} />
  const gainsSegments = [
    { name: 'Long term', value: longTerm, display: signed(longTerm) },
    { name: 'Short term', value: shortTerm, display: signed(shortTerm) },
  ]

  // A chart with no data to show is null and skipped entirely (it also can't be placed or hidden).
  const nodes: Record<string, ReactNode> = {
    allocation: (
          <section className="mne-card">
            <div className="mne-chart-head">
              <Eyebrow icon={PieChart}>Portfolio allocation</Eyebrow>
              <MultiDropdown
                label="Subtypes"
                alignRight
                options={ALL_SUBTYPES.map((v) => ({ value: v, label: v }))}
                values={ALL_SUBTYPES.filter((v) => activeSubtypes.has(v))}
                onChange={(vals) => setActiveSubtypes(new Set(vals))}
              />
            </div>
            <div className={hiddenValueClass(hideValues)}>
              <StackBreakdown segments={allocation} label="Portfolio allocation by asset type" />
            </div>
          </section>
    ),
    'by-account': (
          <section className="mne-card">
            <Eyebrow icon={Landmark}>By account</Eyebrow>
            <div className={hiddenValueClass(hideValues)}>
              {locations.length > 0
                ? <TrackBars rows={locations} />
                : <p className="mne-help" style={{ marginTop: 14 }}>No data</p>}
            </div>
          </section>
    ),
    pnl: pnlData.length > 0 ? (
<section className="mne-card">
              <div className="mne-chart-head">
                <Eyebrow icon={TrendingUp}>Unrealized P&amp;L</Eyebrow>
                <span className={hiddenValueClass(hideValues)}>{signed(totalPnl)}</span>
              </div>
              <div className={hiddenValueClass(hideValues)}>
                <DivergingBars rows={pnlData.map((p) => ({ name: p.name, value: p.gain }))} />
              </div>
            </section>
    ) : null,
    'theme-distribution': (
          <section className="mne-card">
            <div className="mne-chart-head">
              <Eyebrow icon={Layers}>Stock distribution by theme</Eyebrow>
              <Dropdown
                label="Theme distribution scope"
                alignRight
                value={includeCashInThemeDistribution ? 'cash' : 'stocks'}
                options={[{ value: 'stocks', label: 'Stocks only' }, { value: 'cash', label: 'Stocks + cash' }]}
                onChange={(v) => setIncludeCashInThemeDistribution(v === 'cash')}
              />
            </div>
            <div className={hiddenValueClass(hideValues)}>
              {themeDistribution.length > 0
                ? (
                  <ThemeTargetBars
                    rows={capSegments(themeDistribution, 8)}
                    // Targets are shares of the ticker-held portfolio; adding cash changes the denominator.
                    targets={includeCashInThemeDistribution ? undefined : themeTargets}
                  />
                )
                : <p className="mne-help" style={{ marginTop: 14 }}>No themed stock data yet</p>}
            </div>
          </section>
    ),
    'capital-gains': (activeGainsSymbol !== '' || shortTerm !== 0 || longTerm !== 0) ? (
            <section className="mne-card">
              <div className="mne-chart-head">
                <Eyebrow icon={Scale}>Capital gains exposure</Eyebrow>
                <Dropdown
                  label="Filter capital gains by ticker"
                  alignRight
                  value={activeGainsSymbol}
                  options={[{ value: '', label: 'All tickers' }, ...gainsSymbols.map((sym) => ({ value: sym, label: sym }))]}
                  onChange={setGainsSymbol}
                />
              </div>
              <div className={hiddenValueClass(hideValues)}>
                {gainsGross > 0
                  ? <StackBreakdown segments={gainsSegments} height={20} label="Capital gains by holding period" />
                  : <p className="mne-help" style={{ marginTop: 14 }}>No gains or losses for this ticker.</p>}
              </div>
            </section>
    ) : null,
    'cost-vs-value': cvvData.length > 0 ? (
<section className="mne-card">
              <Eyebrow icon={BarChart3}>Cost basis vs value</Eyebrow>
              <div className={hiddenValueClass(hideValues)}>
                <CostValueBars rows={cvvData} />
              </div>
            </section>
    ) : null,
    'rsu-vesting': rsuData.length > 0 ? (
<section className="mne-card">
              <Eyebrow icon={CalendarClock}>RSU vesting progress</Eyebrow>
              <div className={hiddenValueClass(hideValues)}>
                <RsuVestChart rows={rsuData} hideValues={hideValues} />
              </div>
            </section>
    ) : null,
  }

  return (
    <div className="mne-main">
      <PageHead title="Charts"><DashboardEditButton dash={dash} /></PageHead>
      <DashboardGrid dash={dash} nodes={nodes} />
    </div>
  )
}
