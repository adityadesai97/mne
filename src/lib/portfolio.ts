import type { getAllAssets } from './db/assets'

export type Asset = Awaited<ReturnType<typeof getAllAssets>>[number]

type Transaction = { count: number | string; cost_price: number | string; sold_at_vest?: number | string | null; purchase_date?: string | null }
type StockSubtype = { transactions: Transaction[] | null; rsu_grants: unknown[] | null }
type FixedIncomeLot = { count: number | string; cost_price: number | string; purchase_date: string }

export function netCount(t: Transaction): number {
  return Math.max(0, Number(t.count) - Number(t.sold_at_vest ?? 0))
}
type Ticker = { current_price: number | null; previous_close?: number | null }

export type AssetTyped = {
  asset_type: string
  price: number | null
  ticker: Ticker | null
  stock_subtypes: StockSubtype[] | null
  fixed_income_subtype?: string | null
  interest_rate?: number | null
  maturity_date?: string | null
  face_value?: number | null
  fixed_income_lots?: FixedIncomeLot[] | null
}

// Stock and Crypto share the same ticker-plus-tax-lots model (shares/units ×
// tickers.current_price, cost basis per lot, mark-to-market P&L); only how the
// ticker is priced differs (Finnhub vs CoinGecko — see tickers.kind). Anything
// that's about "a position valued off a live ticker price" should key off this
// rather than asset_type === 'Stock'.
export function isTickerAsset(asset: { asset_type?: string | null }): boolean {
  return asset.asset_type === 'Stock' || asset.asset_type === 'Crypto'
}

// Bond and T-Bill are tradable Fixed Income subtypes — bought in lots (like
// stock tax lots) rather than tracked as a single flat balance. CD and
// Deposit are plain accounts (assets.price) since they can't be traded.
export function isTradableFixedIncome(asset: { asset_type: string; fixed_income_subtype?: string | null }): boolean {
  return asset.asset_type === 'Fixed Income' && (asset.fixed_income_subtype === 'Bond' || asset.fixed_income_subtype === 'T-Bill')
}

export function computeFixedIncomeLotCount(asset: AssetTyped): number {
  return (asset.fixed_income_lots ?? []).reduce((sum, lot) => sum + Number(lot.count), 0)
}

type PlaidSyncedPosition = { plaid_item: { institution_name: string | null; last_synced_at: string | null } | null }
type PlaidSyncableAsset = {
  plaid_synced_positions?: PlaidSyncedPosition[] | null
  stock_subtypes?: { transactions: { plaid_synced_positions?: PlaidSyncedPosition[] | null }[] | null }[] | null
  fixed_income_lots?: { plaid_synced_positions?: PlaidSyncedPosition[] | null }[] | null
}

export interface PlaidSyncInfo {
  synced: boolean
  institutionName: string | null
  lastSyncedAt: string | null
}

// plaid_synced_positions can hang off the asset directly (flat-balance types),
// off one of its transactions (stock tax lots), or off one of its
// fixed_income_lots (Bond/T-Bill lots) — see ASSET_SELECT in db/assets.ts for
// how all three are fetched in one query. This collapses them into one
// "is this asset Plaid-synced, and from where" answer for display.
export function getPlaidSyncInfo(asset: PlaidSyncableAsset): PlaidSyncInfo {
  const rows: PlaidSyncedPosition[] = [
    ...(asset.plaid_synced_positions ?? []),
    ...(asset.stock_subtypes ?? []).flatMap((st) => st.transactions ?? []).flatMap((t) => t.plaid_synced_positions ?? []),
    ...(asset.fixed_income_lots ?? []).flatMap((lot) => lot.plaid_synced_positions ?? []),
  ]
  const withItem = rows.find((r) => r.plaid_item != null)
  return {
    synced: rows.length > 0,
    institutionName: withItem?.plaid_item?.institution_name ?? null,
    lastSyncedAt: withItem?.plaid_item?.last_synced_at ?? null,
  }
}

// There's no live market feed for bonds/bills, so a tradable Fixed Income
// position is valued at cost (sum of lot count × cost per unit) rather than
// marked to market — the same "no live price, so hold at what was paid"
// convention CD/Deposit/401k/Cash/HSA already follow via assets.price.
export function computeFixedIncomeCostBasis(asset: AssetTyped): number {
  const raw = (asset.fixed_income_lots ?? [])
    .reduce((sum, lot) => sum + Number(lot.count) * Number(lot.cost_price), 0)
  return Math.round(raw * 100) / 100
}

export function computeAssetValue(asset: AssetTyped): number {
  if (isTickerAsset(asset)) {
    if (asset.ticker?.current_price == null) return 0
    const price = asset.ticker.current_price
    const shares = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
      .reduce((sum, t) => sum + netCount(t), 0) ?? 0
    return Math.round(price * shares * 100) / 100
  }
  if (isTradableFixedIncome(asset) && (asset.fixed_income_lots?.length ?? 0) > 0) {
    return computeFixedIncomeCostBasis(asset)
  }
  return asset.price ?? 0
}

export function computeCostBasis(asset: AssetTyped): number {
  const raw = asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + netCount(t) * Number(t.cost_price), 0) ?? 0
  return Math.round(raw * 100) / 100
}

export function computeShareCount(asset: AssetTyped): number {
  return asset.stock_subtypes?.flatMap((st) => st.transactions ?? [])
    .reduce((sum, t) => sum + netCount(t), 0) ?? 0
}

// P&L is a ticker-asset (stock/crypto) concept — other assets (Cash, 401k, Fixed Income, HSA, etc.)
// have no cost basis and must never contribute a gain/loss figure. A tradable
// Fixed Income lot's projected return is computeFixedIncomeExpectedReturn,
// a held-to-maturity figure, not a mark-to-market gain/loss.
export function computeUnrealizedGain(asset: AssetTyped): number {
  if (!isTickerAsset(asset)) return 0
  return computeAssetValue(asset) - computeCostBasis(asset)
}

export function computeTotalNetWorth(assets: AssetTyped[]): number {
  return assets.reduce((sum, a) => sum + computeAssetValue(a), 0)
}

export type DailyChange = {
  dollarChange: number
  percentChange: number
  /** Every lot in the position was bought today, so the move is the
   *  position's return since purchase rather than the asset's move since the
   *  last close. Absent otherwise. */
  sinceBuy?: true
}

/** Today's date (YYYY-MM-DD) in the user's local time zone — purchase dates
 *  are typed in as the user's own calendar date, so "bought today" must be
 *  judged against the local date, not UTC. */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export type DailyPosition = {
  /** Σ units × (currentPrice − anchor), unrounded. */
  dollarChange: number
  /** Σ units × anchor — the value the move is measured against. */
  startValue: number
  allBoughtToday: boolean
}

/** Today's move for a position, measured on what the user held: a lot bought
 *  before today is anchored at the ticker's previous_close, but a lot bought
 *  *today* is anchored at its own cost price — those units weren't in the
 *  portfolio for the earlier part of the day, so the move from the last close
 *  up to the moment of purchase isn't the portfolio's move. A lot with no
 *  purchase date, or with no usable cost basis, keeps the previous_close
 *  anchor. For crypto, previous_close is the price 24h ago and purchase dates
 *  are whole days, so "bought today" (local calendar day) is an approximation
 *  of "bought within the last 24h". */
export function computeDailyPosition(asset: AssetTyped, today: string = localDateKey()): DailyPosition | null {
  if (!isTickerAsset(asset)) return null
  const currentPrice = asset.ticker?.current_price
  const previousClose = asset.ticker?.previous_close
  if (currentPrice == null || previousClose == null || previousClose === 0) return null

  let dollarChange = 0
  let startValue = 0
  let units = 0
  let allBoughtToday = true
  for (const lot of (asset.stock_subtypes ?? []).flatMap((st) => st.transactions ?? [])) {
    const lotUnits = netCount(lot)
    if (lotUnits <= 0) continue
    const costPrice = Number(lot.cost_price)
    const boughtToday = typeof lot.purchase_date === 'string' && lot.purchase_date >= today && costPrice > 0
    const anchor = boughtToday ? costPrice : previousClose
    dollarChange += lotUnits * (currentPrice - anchor)
    startValue += lotUnits * anchor
    units += lotUnits
    if (!boughtToday) allBoughtToday = false
  }
  if (units <= 0 || startValue <= 0) return null
  return { dollarChange, startValue, allBoughtToday }
}

// Today's move for a single position, derived from the ticker's last
// refreshed quote (current_price vs previous_close) rather than the net
// worth snapshot series — this reflects live prices even before today's
// snapshot has been recorded. Measured on what the user held (see
// computeDailyPosition): a lot bought today counts only from its purchase
// price. Returns null when there isn't enough data to compute a change
// (non-ticker asset, no shares held, or previous_close not yet populated by
// a price refresh). With no lot bought today this is exactly
// shares × (current − previous_close) and (current − previous_close) /
// previous_close, as before.
export function computeDailyChange(asset: AssetTyped, today: string = localDateKey()): DailyChange | null {
  const position = computeDailyPosition(asset, today)
  if (!position) return null
  return {
    dollarChange: Math.round(position.dollarChange * 100) / 100,
    percentChange: (position.dollarChange * 100) / position.startValue,
    ...(position.allBoughtToday ? { sinceBuy: true as const } : {}),
  }
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000

function yearsBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`).getTime()
  const end = new Date(`${endIso}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return (end - start) / MS_PER_YEAR
}

export type FixedIncomeExpectedReturn = {
  costBasis: number
  faceValueTotal: number
  // Price appreciation realized at maturity (faceValueTotal - costBasis) —
  // the whole return for a T-Bill, and the premium/discount-to-par component
  // for a Bond.
  capitalGain: number
  // Bond only: coupon income accrued from each lot's purchase date through
  // maturity, at the asset's interest_rate. Zero for T-Bills, which pay no
  // periodic interest — their entire return is the discount captured above.
  interestIncome: number
  totalExpectedReturn: number
  expectedReturnPct: number | null
  // Simple (non-compounded) annualization of expectedReturnPct over the
  // cost-basis-weighted average holding period to maturity.
  annualizedYieldPct: number | null
}

// Expected pretax return if a tradable Fixed Income lot (Bond or T-Bill) is
// held to maturity: the discount/premium to face value captured at
// maturity, plus (for Bonds) coupon interest earned along the way. This is
// a held-to-maturity projection, not a mark-to-market gain — it has nothing
// to do with computeUnrealizedGain, which stays stock-only. Returns null
// when the asset isn't a tradable Fixed Income position, has no lots yet,
// or is missing the face_value/maturity_date the projection depends on.
export function computeFixedIncomeExpectedReturn(asset: AssetTyped): FixedIncomeExpectedReturn | null {
  if (!isTradableFixedIncome(asset)) return null
  const lots = asset.fixed_income_lots ?? []
  if (lots.length === 0) return null
  const faceValuePerUnit = asset.face_value != null ? Number(asset.face_value) : null
  const maturityDate = asset.maturity_date
  if (faceValuePerUnit == null || !maturityDate) return null
  const rate = asset.interest_rate != null ? Number(asset.interest_rate) : 0
  const isBond = asset.fixed_income_subtype === 'Bond'

  let costBasis = 0
  let faceValueTotal = 0
  let interestIncome = 0
  let weightedYears = 0
  for (const lot of lots) {
    const count = Number(lot.count)
    const costPrice = Number(lot.cost_price)
    const lotCostBasis = count * costPrice
    costBasis += lotCostBasis
    faceValueTotal += count * faceValuePerUnit
    const years = Math.max(0, yearsBetween(lot.purchase_date, maturityDate))
    weightedYears += lotCostBasis * years
    if (isBond && rate > 0) {
      interestIncome += count * faceValuePerUnit * (rate / 100) * years
    }
  }

  const capitalGain = faceValueTotal - costBasis
  const totalExpectedReturn = capitalGain + interestIncome
  const expectedReturnPct = costBasis > 0 ? (totalExpectedReturn / costBasis) * 100 : null
  const avgYears = costBasis > 0 ? weightedYears / costBasis : 0
  const annualizedYieldPct = expectedReturnPct != null && avgYears > 0 ? expectedReturnPct / avgYears : null

  return {
    costBasis: Math.round(costBasis * 100) / 100,
    faceValueTotal: Math.round(faceValueTotal * 100) / 100,
    capitalGain: Math.round(capitalGain * 100) / 100,
    interestIncome: Math.round(interestIncome * 100) / 100,
    totalExpectedReturn: Math.round(totalExpectedReturn * 100) / 100,
    expectedReturnPct,
    annualizedYieldPct,
  }
}
