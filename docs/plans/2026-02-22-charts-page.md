# Charts Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Tax page with a Charts page containing 6 portfolio-relevant charts built with Recharts.

**Architecture:** Three tasks — (1) swap the route/nav, (2) extract pure chart-data helpers into `src/lib/charts.ts` with unit tests, (3) build the full `Charts.tsx` page using those helpers. All data comes from the existing `getAllAssets()` call; no new backend work needed.

**Tech Stack:** Recharts (already installed), Lucide icons, Tailwind CSS, React

---

### Task 1: Swap route, nav, and claude tool — no charts yet

**Files:**
- Delete: `src/pages/Tax.tsx`
- Create: `src/pages/Charts.tsx`
- Modify: `src/router.tsx`
- Modify: `src/layouts/BottomNav.tsx`
- Modify: `src/lib/claude.ts`
- Modify: `src/__tests__/BottomNav.test.tsx`

**Step 1: Delete Tax.tsx**

```bash
rm src/pages/Tax.tsx
```

**Step 2: Create the Charts page shell**

`src/pages/Charts.tsx`:
```tsx
export default function Charts() {
  return (
    <div className="pt-6 pb-24 px-4 space-y-4">
      <h1 className="text-xl font-bold">Charts</h1>
    </div>
  )
}
```

**Step 3: Update router.tsx**

Replace the current content of `src/router.tsx` with:
```tsx
import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Home from './pages/Home'
import Portfolio from './pages/Portfolio'
import Charts from './pages/Charts'
import Watchlist from './pages/Watchlist'
import Settings from './pages/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'portfolio', element: <Portfolio /> },
      { path: 'charts', element: <Charts /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])
```

**Step 4: Update BottomNav.tsx**

Replace the current content of `src/layouts/BottomNav.tsx` with:
```tsx
import { NavLink } from 'react-router-dom'
import { Home, BarChart2, PieChart, Star, Settings } from 'lucide-react'

const tabs = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/portfolio', icon: BarChart2, label: 'Portfolio' },
  { to: '/charts', icon: PieChart, label: 'Charts' },
  { to: '/watchlist', icon: Star, label: 'Watchlist' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around py-2 z-50" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
      {tabs.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-1 px-4 py-1 text-xs ${
              isActive ? 'text-primary' : 'text-muted-foreground'
            }`
          }
        >
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
```

**Step 5: Update navigate_to enum in claude.ts**

Find the `navigate_to` tool's `route` property in `src/lib/claude.ts`. Change its enum from:
```typescript
route: { type: 'string', enum: ['/', '/portfolio', '/tax', '/watchlist', '/settings'] },
```
to:
```typescript
route: { type: 'string', enum: ['/', '/portfolio', '/charts', '/watchlist', '/settings'] },
```

**Step 6: Fix the BottomNav test**

Replace the content of `src/__tests__/BottomNav.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import BottomNav from '../layouts/BottomNav'

function renderWithRouter(initialEntry = '/') {
  const router = createMemoryRouter(
    [{ path: '*', element: <BottomNav /> }],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

test('renders all nav tabs', () => {
  renderWithRouter()
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(screen.getByText('Portfolio')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Watchlist')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
})
```

**Step 7: Run tests**

```bash
npm test 2>&1 | tail -8
```
Expected: all tests pass (Tax page had no tests; BottomNav test now expects "Charts").

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: replace Tax page with Charts page (shell)"
```

---

### Task 2: Chart data helpers + unit tests

**Files:**
- Create: `src/lib/charts.ts`
- Create: `src/__tests__/charts.test.ts`

All helpers are pure functions — no Supabase, no React. Test them in isolation.

**Step 1: Create the test file first**

`src/__tests__/charts.test.ts`:
```typescript
import { describe, test, expect } from 'vitest'
import {
  groupByAssetType,
  groupByLocation,
  computeUnrealizedPnLByPosition,
  computeCapitalGainsExposure,
  computeCostVsValue,
  computeRsuVesting,
} from '../lib/charts'

// ── Shared fixture ────────────────────────────────────────────
const stockAsset = {
  asset_type: 'Stock',
  name: 'Apple Stock',
  price: null,
  ticker: { symbol: 'AAPL', current_price: 200 },
  location: { name: 'Fidelity' },
  stock_subtypes: [
    {
      subtype: 'Market',
      transactions: [
        { count: 10, cost_price: 150, capital_gains_status: 'Long Term' },
      ],
      rsu_grants: [],
    },
    {
      subtype: 'RSU',
      transactions: [
        { count: 5, cost_price: 100, capital_gains_status: 'Short Term' },
      ],
      rsu_grants: [
        {
          grant_date: '2023-01-01',
          total_shares: 100,
          vest_start: '2023-01-01',
          vest_end: '2027-01-01',
          cliff_date: null,
        },
      ],
    },
  ],
}

const cashAsset = {
  asset_type: 'Cash',
  name: 'Checking',
  price: 5000,
  ticker: null,
  location: { name: 'Chase' },
  stock_subtypes: [],
}

// ── groupByAssetType ──────────────────────────────────────────
describe('groupByAssetType', () => {
  test('includes all subtypes when all active', () => {
    const result = groupByAssetType([stockAsset, cashAsset], new Set(['Market', 'ESPP', 'RSU']))
    const stock = result.find(g => g.type === 'Stock')!
    // 10 Market shares + 5 RSU shares = 15 shares × $200 = $3000
    expect(stock.value).toBe(3000)
    const cash = result.find(g => g.type === 'Cash')!
    expect(cash.value).toBe(5000)
  })

  test('excludes RSU shares when RSU toggled off', () => {
    const result = groupByAssetType([stockAsset], new Set(['Market', 'ESPP']))
    const stock = result.find(g => g.type === 'Stock')!
    // Only 10 Market shares × $200 = $2000
    expect(stock.value).toBe(2000)
  })

  test('filters out zero-value groups', () => {
    // Toggle off all subtypes — Stock drops to 0, should not appear
    const result = groupByAssetType([stockAsset], new Set<string>())
    expect(result.find(g => g.type === 'Stock')).toBeUndefined()
  })
})

// ── groupByLocation ───────────────────────────────────────────
describe('groupByLocation', () => {
  test('sums value by location name', () => {
    const result = groupByLocation([stockAsset, cashAsset])
    const fidelity = result.find(g => g.name === 'Fidelity')!
    // 15 shares × $200 = $3000
    expect(fidelity.value).toBe(3000)
    const chase = result.find(g => g.name === 'Chase')!
    expect(chase.value).toBe(5000)
  })
})

// ── computeUnrealizedPnLByPosition ───────────────────────────
describe('computeUnrealizedPnLByPosition', () => {
  test('computes gain per stock position', () => {
    const result = computeUnrealizedPnLByPosition([stockAsset, cashAsset])
    // Only stocks returned
    expect(result).toHaveLength(1)
    // value = 15 × 200 = 3000, cost = 10×150 + 5×100 = 2000, gain = 1000
    expect(result[0].gain).toBe(1000)
    expect(result[0].name).toBe('Apple Stock')
  })

  test('excludes positions with zero gain', () => {
    const flat = {
      ...stockAsset,
      ticker: { symbol: 'XYZ', current_price: 150 },
      stock_subtypes: [
        { subtype: 'Market', transactions: [{ count: 1, cost_price: 150, capital_gains_status: 'Short Term' }], rsu_grants: [] },
      ],
    }
    const result = computeUnrealizedPnLByPosition([flat])
    expect(result).toHaveLength(0)
  })
})

// ── computeCapitalGainsExposure ───────────────────────────────
describe('computeCapitalGainsExposure', () => {
  test('sums short and long term gains', () => {
    const result = computeCapitalGainsExposure([stockAsset])
    // Long Term: 10 × (200 - 150) = 500
    expect(result.longTerm).toBe(500)
    // Short Term: 5 × (200 - 100) = 500
    expect(result.shortTerm).toBe(500)
  })
})

// ── computeCostVsValue ────────────────────────────────────────
describe('computeCostVsValue', () => {
  test('returns cost basis and current value for stocks', () => {
    const result = computeCostVsValue([stockAsset, cashAsset])
    expect(result).toHaveLength(1)
    expect(result[0].costBasis).toBe(2000)   // 10×150 + 5×100
    expect(result[0].currentValue).toBe(3000) // 15×200
  })
})

// ── computeRsuVesting ─────────────────────────────────────────
describe('computeRsuVesting', () => {
  test('computes vested shares linearly', () => {
    // Grant: 100 shares, vest_start 2023-01-01, vest_end 2027-01-01 (4 years)
    // today = 2025-01-01 → 2 years elapsed of 4 → 50 shares vested
    const today = new Date('2025-01-01')
    const result = computeRsuVesting([stockAsset], today)
    expect(result).toHaveLength(1)
    expect(result[0].vestedShares).toBe(50)
    expect(result[0].unvestedShares).toBe(50)
  })

  test('returns 0 vested if before cliff', () => {
    const grantWithCliff = {
      ...stockAsset,
      stock_subtypes: [
        {
          subtype: 'RSU',
          transactions: [],
          rsu_grants: [{
            grant_date: '2024-01-01',
            total_shares: 100,
            vest_start: '2024-01-01',
            vest_end: '2028-01-01',
            cliff_date: '2025-01-01',
          }],
        },
      ],
    }
    const today = new Date('2024-07-01') // before cliff
    const result = computeRsuVesting([grantWithCliff], today)
    expect(result[0].vestedShares).toBe(0)
    expect(result[0].unvestedShares).toBe(100)
  })

  test('returns all vested if past vest_end', () => {
    const today = new Date('2030-01-01')
    const result = computeRsuVesting([stockAsset], today)
    expect(result[0].vestedShares).toBe(100)
    expect(result[0].unvestedShares).toBe(0)
  })

  test('returns empty array if no RSU grants', () => {
    const result = computeRsuVesting([cashAsset])
    expect(result).toHaveLength(0)
  })
})
```

**Step 2: Run tests — expect failures**

```bash
npm test 2>&1 | tail -8
```
Expected: failures referencing `../lib/charts` not found.

**Step 3: Create `src/lib/charts.ts`**

```typescript
import { computeAssetValue, computeCostBasis, computeUnrealizedGain } from './portfolio'

// ── Portfolio Allocation ──────────────────────────────────────

export function groupByAssetType(assets: any[], activeSubtypes: Set<string>) {
  const map: Record<string, number> = {}
  for (const a of assets) {
    const val = filteredStockValue(a, activeSubtypes)
    map[a.asset_type] = (map[a.asset_type] ?? 0) + val
  }
  return Object.entries(map)
    .map(([type, value]) => ({ type, value }))
    .filter(g => g.value > 0)
}

function filteredStockValue(asset: any, activeSubtypes: Set<string>): number {
  if (asset.asset_type !== 'Stock') return asset.price ?? 0
  if (!asset.ticker?.current_price) return 0
  const price = asset.ticker.current_price
  const shares = (asset.stock_subtypes ?? [])
    .filter((st: any) => activeSubtypes.has(st.subtype))
    .flatMap((st: any) => st.transactions ?? [])
    .reduce((sum: number, t: any) => sum + Number(t.count), 0)
  return Math.round(price * shares * 100) / 100
}

// ── By Location ───────────────────────────────────────────────

export function groupByLocation(assets: any[]) {
  const map: Record<string, number> = {}
  for (const a of assets) {
    const name = a.location?.name ?? 'Unknown'
    map[name] = (map[name] ?? 0) + computeAssetValue(a)
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter(g => g.value > 0)
}

// ── Unrealized P&L by Position ────────────────────────────────

export function computeUnrealizedPnLByPosition(assets: any[]) {
  return assets
    .filter(a => a.asset_type === 'Stock')
    .map(a => ({ name: a.name, gain: computeUnrealizedGain(a) }))
    .filter(p => p.gain !== 0)
    .sort((a, b) => b.gain - a.gain)
}

// ── Capital Gains Exposure ────────────────────────────────────

export function computeCapitalGainsExposure(assets: any[]) {
  let shortTerm = 0
  let longTerm = 0
  for (const a of assets) {
    const price = a.ticker?.current_price ?? 0
    for (const st of a.stock_subtypes ?? []) {
      for (const t of st.transactions ?? []) {
        const gain = Number(t.count) * (price - Number(t.cost_price))
        if (t.capital_gains_status === 'Short Term') shortTerm += gain
        else longTerm += gain
      }
    }
  }
  return { shortTerm, longTerm }
}

// ── Cost Basis vs Current Value ───────────────────────────────

export function computeCostVsValue(assets: any[]) {
  return assets
    .filter(a => a.asset_type === 'Stock' && computeAssetValue(a) > 0)
    .map(a => ({
      name: a.name,
      costBasis: computeCostBasis(a),
      currentValue: computeAssetValue(a),
    }))
}

// ── RSU Vesting Progress ──────────────────────────────────────

export type RsuVestRow = {
  label: string
  vestedShares: number
  unvestedShares: number
  totalShares: number
}

export function computeRsuVesting(assets: any[], today: Date = new Date()): RsuVestRow[] {
  const rows: RsuVestRow[] = []
  for (const a of assets) {
    for (const st of a.stock_subtypes ?? []) {
      if (st.subtype !== 'RSU') continue
      for (const grant of st.rsu_grants ?? []) {
        const vestStart = new Date(grant.vest_start)
        const vestEnd = new Date(grant.vest_end)
        const cliffDate = grant.cliff_date ? new Date(grant.cliff_date) : null
        const total = Number(grant.total_shares)

        let vested = 0
        if (today >= vestEnd) {
          vested = total
        } else if (today >= vestStart && (!cliffDate || today >= cliffDate)) {
          const elapsed = today.getTime() - vestStart.getTime()
          const duration = vestEnd.getTime() - vestStart.getTime()
          vested = Math.floor((elapsed / duration) * total)
        }

        rows.push({
          label: `${a.ticker?.symbol ?? a.name} · ${grant.grant_date}`,
          vestedShares: vested,
          unvestedShares: total - vested,
          totalShares: total,
        })
      }
    }
  }
  return rows
}
```

**Step 4: Run tests**

```bash
npm test 2>&1 | tail -8
```
Expected: all tests pass (the new charts tests plus the existing 19).

**Step 5: Commit**

```bash
git add src/lib/charts.ts src/__tests__/charts.test.ts
git commit -m "feat: chart data helpers with unit tests"
```

---

### Task 3: Build the full Charts page

**Files:**
- Modify: `src/pages/Charts.tsx`

Replace the shell with the full page. This task is all in one file.

**Step 1: Write Charts.tsx**

```tsx
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
                  formatter={(v: number) => fmt(v)}
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
                  formatter={(v: number) => fmt(v)}
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
                    formatter={(v: number) => fmt(v)}
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
                    formatter={(v: number) => fmt(v)}
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
                    formatter={(v: number) => fmtShort(v)}
                    style={{ fontSize: 10, fill: 'hsl(0,0%,60%)' }}
                  />
                </Bar>
                <Bar dataKey="currentValue" name="Current Value" fill={GAIN_COLOR} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="currentValue"
                    position="right"
                    formatter={(v: number) => fmtShort(v)}
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
```

**Step 2: Run build**

```bash
npm run build 2>&1 | grep -E 'error|✓|ERROR'
```
Expected: `✓ built in ...`

**Step 3: Run tests**

```bash
npm test 2>&1 | tail -8
```
Expected: all tests pass.

**Step 4: Visual check in browser**

- Navigate to `/charts` — should show "Charts" heading
- With portfolio data: all 6 cards appear, charts render with correct data
- Toggle off "RSU" chip → Stock slice in allocation donut shrinks
- Charts with no data (e.g. no RSU grants) simply don't render their cards

**Step 5: Commit**

```bash
git add src/pages/Charts.tsx
git commit -m "feat: charts page with 6 portfolio charts"
```
