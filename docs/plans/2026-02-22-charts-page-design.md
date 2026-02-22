# Charts Page Design

## Summary

Replace the Tax page (`/tax`, Receipt icon) with a Charts page (`/charts`, PieChart icon). All charts are computed from the existing asset data already loaded via `getAllAssets()`. No new backend work needed. Recharts is already installed.

## Nav Change

- Remove: `/tax` route + Tax tab (Receipt icon)
- Add: `/charts` route + Charts tab (PieChart icon from lucide-react)
- Update `navigate_to` tool enum in `claude.ts` to replace `/tax` with `/charts`

## Charts

### 1. Portfolio Allocation (Donut + subtype filter)

**Component:** `PieChart` + `Pie` (innerRadius set for donut look)

**Data:** Sum `computeAssetValue` per asset type. For Stock assets, only include share lots whose `stock_subtypes.subtype` is in the active filter set.

**Filter:** Three toggle chips above the chart — `Market`, `ESPP`, `RSU` — all on by default. Toggling one off excludes shares of that subtype from the Stock value in the donut. Non-stock assets (401k, Cash, HSA, etc.) are unaffected.

**State:** `activeSubtypes: Set<'Market' | 'ESPP' | 'RSU'>` — local to the Charts page component.

### 2. By Account (Donut)

**Component:** `PieChart` + `Pie`

**Data:** Sum `computeAssetValue` per `asset.location.name`. Groups all asset types together.

### 3. Unrealized P&L by Position (Horizontal Bar)

**Component:** `BarChart` layout="vertical"

**Data:** One entry per stock asset. `gain = computeUnrealizedGain(asset)`. Sorted best → worst. Bars colored green (gain ≥ 0) or red (gain < 0) via `Cell`.

**Label:** Asset name on the Y axis, dollar gain/loss value as bar label.

### 4. Capital Gains Exposure (Grouped Bar)

**Component:** `BarChart`

**Data:** Two bars — Short-Term gain total and Long-Term gain total. Computed from all `transactions` across all stock assets (same logic as old Tax page). Bars colored green/red based on sign.

### 5. Cost Basis vs Current Value (Grouped Bar)

**Component:** `BarChart`

**Data:** One group per stock asset. Two bars per group: `costBasis` (muted color) and `currentValue` (primary color). Uses `computeCostBasis` and `computeAssetValue`.

### 6. RSU Vesting Progress (Stacked Horizontal Bar)

**Visibility:** Only rendered if any asset has `stock_subtypes` with `subtype === 'RSU'` and non-empty `rsu_grants`.

**Component:** `BarChart` layout="vertical" with two stacked `Bar`s.

**Data:** One row per RSU grant. Per grant:
- `vestedShares`: linear proration from `vest_start` to today relative to full vest period (`vest_end - vest_start`), clamped to `[0, total_shares]`. If today < `cliff_date`, `vestedShares = 0`.
- `unvestedShares`: `total_shares - vestedShares`

**Label:** `{symbol} · {grant_date}` on the Y axis. Vested % shown as bar label.

**Colors:** vested = green (`text-gain`), unvested = muted foreground.

## Layout

Single scrollable column at `/charts`. Page title "Charts". Each chart wrapped in a `Card` with a `CardHeader` title and `CardContent`. `ResponsiveContainer width="100%"` on all charts for full-width responsiveness. Standard padding: `pt-6 pb-24 px-4 space-y-4`.

## Files to Touch

- `src/pages/Tax.tsx` — delete
- `src/pages/Charts.tsx` — new file
- `src/router.tsx` — replace tax route with charts route
- `src/layouts/BottomNav.tsx` — swap Tax tab for Charts tab
- `src/lib/claude.ts` — update `navigate_to` enum: replace `/tax` with `/charts`
