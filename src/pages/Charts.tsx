import { useEffect, useState } from 'react'
import { getAllAssets } from '@/lib/db/assets'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, LabelList,
} from 'recharts'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  computeCostVsValue,
  computeRsuVesting,
} from '@/lib/charts'

type Subtype = 'Market' | 'ESPP' | 'RSU'
const ALL_SUBTYPES: Subtype[] = ['Market', 'ESPP', 'RSU']

const PALETTE = ['#00ff80', '#7c3aed', '#0ea5e9', '#f59e0b', '#ec4899', '#14b8a6']
const GAIN_COLOR = 'hsl(153, 100%, 50%)'
const LOSS_COLOR = 'hsl(0, 84%, 60%)'
const MUTED_COLOR = 'hsl(0, 0%, 30%)'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0,
  }).format(n)
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(Math.round(n))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtLabel = (v: any) => fmt(v as number)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtShortLabel = (v: any) => fmtShort(v as number)

export default function Charts() {
  const [assets, setAssets] = useState<any[]>([])
  const [activeSubtypes, setActiveSubtypes] = useState<Set<Subtype>>(new Set(ALL_SUBTYPES))

  useEffect(() => { getAllAssets().then(setAssets).catch(console.error) }, [])

  function toggleSubtype(s: Subtype) {
    setActiveSubtypes(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  const allocationData = groupByAssetType(assets, activeSubtypes)
  const locationData = groupByLocation(assets)
  const pnlData = computeUnrealizedPnLByPosition(assets)
  const { shortTerm, longTerm } = computeCapitalGainsExposure(assets)
  const cvvData = computeCostVsValue(assets)
  const rsuData = computeRsuVesting(assets)

  return (
    <div className="pt-6 pb-24 px-4 space-y-4">
      <h1 className="text-xl font-bold">Charts</h1>

      {/* ── 1. Portfolio Allocation ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Portfolio Allocation</CardTitle>
          <div className="flex gap-2 flex-wrap mt-1">
            {ALL_SUBTYPES.map(s => (
              <button
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
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={allocationData}
                  dataKey="value"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {allocationData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'hsl(0,0%,9%)', border: '1px solid hsl(0,0%,14%)', borderRadius: 8 }}
                  formatter={fmtLabel}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {allocationData.map((g, i) => (
              <div key={g.type} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-muted-foreground">{g.type}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 2. By Account ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">By Account</CardTitle>
        </CardHeader>
        <CardContent>
          {locationData.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={locationData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {locationData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'hsl(0,0%,9%)', border: '1px solid hsl(0,0%,14%)', borderRadius: 8 }}
                  formatter={fmtLabel}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {locationData.map((g, i) => (
              <div key={g.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-muted-foreground">{g.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Unrealized P&L by Position ── */}
      {pnlData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unrealized P&L by Position</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(180, pnlData.length * 44)}>
              <BarChart data={pnlData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fill: 'hsl(0,0%,60%)' }} />
                <XAxis type="number" hide />
                <Bar dataKey="gain" radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="gain"
                    position="right"
                    formatter={fmtLabel}
                    style={{ fontSize: 11, fill: 'hsl(0,0%,60%)' }}
                  />
                  {pnlData.map((d, i) => (
                    <Cell key={i} fill={d.gain >= 0 ? GAIN_COLOR : LOSS_COLOR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── 4. Capital Gains Exposure ── */}
      {(shortTerm !== 0 || longTerm !== 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Capital Gains Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={[
                  { label: 'Short-Term', value: shortTerm },
                  { label: 'Long-Term', value: longTerm },
                ]}
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(0,0%,60%)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={fmtLabel}
                    style={{ fontSize: 11, fill: 'hsl(0,0%,60%)' }}
                  />
                  {[shortTerm, longTerm].map((v, i) => (
                    <Cell key={i} fill={v >= 0 ? GAIN_COLOR : LOSS_COLOR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── 5. Cost Basis vs Current Value ── */}
      {cvvData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Cost Basis vs Current Value</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(180, cvvData.length * 60)}>
              <BarChart data={cvvData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11, fill: 'hsl(0,0%,60%)' }} />
                <XAxis type="number" hide />
                <Bar dataKey="costBasis" name="Cost Basis" fill={MUTED_COLOR} radius={[0, 0, 0, 0]}>
                  <LabelList
                    dataKey="costBasis"
                    position="right"
                    formatter={fmtShortLabel}
                    style={{ fontSize: 10, fill: 'hsl(0,0%,60%)' }}
                  />
                </Bar>
                <Bar dataKey="currentValue" name="Current Value" fill={GAIN_COLOR} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="currentValue"
                    position="right"
                    formatter={fmtShortLabel}
                    style={{ fontSize: 10, fill: 'hsl(0,0%,60%)' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── 6. RSU Vesting Progress ── */}
      {rsuData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">RSU Vesting Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(180, rsuData.length * 52)}>
              <BarChart data={rsuData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                <YAxis dataKey="label" type="category" width={130} tick={{ fontSize: 11, fill: 'hsl(0,0%,60%)' }} />
                <XAxis type="number" hide />
                <Bar dataKey="vestedShares" name="Vested" stackId="vest" fill={GAIN_COLOR} />
                <Bar dataKey="unvestedShares" name="Unvested" stackId="vest" fill={MUTED_COLOR} radius={[0, 4, 4, 0]}>
                  <LabelList
                    content={({ x, y, width, height, index }: any) => {
                      const row = rsuData[index]
                      const pct = Math.round((row.vestedShares / row.totalShares) * 100)
                      return (
                        <text
                          x={Number(x) + Number(width) + 6}
                          y={Number(y) + Number(height) / 2}
                          dy={4}
                          fontSize={11}
                          fill="hsl(0,0%,60%)"
                        >
                          {pct}%
                        </text>
                      )
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
