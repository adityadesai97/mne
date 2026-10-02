// Portfolio Performance Explanation — see CLAUDE.md for the full design.
//
// Everything that can be computed from data already in memory (which
// holdings moved, how much, whether that's a theme-wide or market-wide
// pattern) is pure JS here — the LLM is only ever handed a short digest of
// the result and asked to phrase it into prose. The full explanation is
// generated ONLY on demand (a user opening it from the Home page teaser),
// never by a background job — `buildTeaser` (the Home page card's one-line
// hook) needs no LLM call at all, it's derived straight from computeMovers.

import { getAllAssets } from './db/assets'
import {
  getPortfolioExplanation,
  upsertPortfolioExplanation,
  type PortfolioExplanationHeadline,
  type PortfolioExplanationMover,
  type PortfolioExplanationRow,
  type PortfolioExplanationScope,
  type PortfolioExplanationThemeMove,
  type PortfolioExplanationTimeframe,
} from './db/portfolioExplanations'
import { getTickerPriceHistory, type TickerPricePoint } from './db/tickerPriceHistory'
import { logLlmUsage } from './db/llmUsage'
import { computeDailyPosition, computeShareCount, computeTotalNetWorth, isTickerAsset, netCount } from './portfolio'
import { createLLMClient, MODEL_FOR_PROVIDER } from './llm'
import { config } from '@/store/config'

// ── Tunable constants ─────────────────────────────────────────────────────
/** Fraction of the day's total absolute swing the mover list should cover. */
export const MOVER_COVERAGE_TARGET = 0.7
export const MAX_MOVERS = 5
/** A single holding's own move big enough to call out regardless of its
 *  portfolio-level weight (mirrors the default price_alert_threshold). */
export const MAJOR_MOVE_STOCK_PCT = 5
/** Crypto routinely swings several times harder than equities, so its
 *  per-holding/per-sector "major move" bar is this multiple of the stock bar
 *  at every timeframe — otherwise a 5% daily bar would flag a coin nearly
 *  every day and crowd the carousel. Stock bars are untouched. */
export const CRYPTO_MOVE_BAR_MULTIPLIER = 2
/** The effective major-move bar for a holding/theme: `stockPct`, scaled up
 *  for crypto. */
function moveBar(stockPct: number, crypto?: boolean): number {
  return crypto ? stockPct * CRYPTO_MOVE_BAR_MULTIPLIER : stockPct
}
/** Aggregate portfolio swing big enough to count as a "major move" on its
 *  own, even with no single outsized holding. */
export const MAJOR_MOVE_PORTFOLIO_PCT = 1
/** Percentage-point change (or a sign flip) in the day's swing since the
 *  last generation before it's worth spending another LLM call. */
export const REGENERATION_HYSTERESIS_PCT = 0.75
/** Below this, a holding's move is noise for breadth/theme purposes. */
export const NOISE_BAND_PCT = 0.3
export const BROAD_MOVE_MIN_POSITIONS = 3
export const BROAD_MOVE_MAJORITY = 0.6
/** A single mover dominant enough to name directly in the teaser/prompt
 *  rather than talking about "N holdings" in the abstract. */
export const DOMINANT_MOVER_CONTRIBUTION_PCT = 50

/** A single Portfolio Pulse carousel card: one insight, independently
 *  generated/cached/regenerated. `scopeKey` is '' for scope 'portfolio',
 *  the symbol for 'stock', the theme name for 'sector'. `windowDays` is the
 *  actual day-count backing `timeframe` (1/7/30/365, or an arbitrary value
 *  for 'custom') — see the matching columns on portfolio_explanations. */
export interface PortfolioInsightSlot {
  scope: PortfolioExplanationScope
  scopeKey: string
  timeframe: PortfolioExplanationTimeframe
  windowDays: number
}

/** The one slot that existed before the carousel — kept as a named constant
 *  so the still-single-card UI can keep behaving exactly as before while
 *  the generation/storage layer underneath is generalized. */
export const DAILY_PORTFOLIO_SLOT: PortfolioInsightSlot = { scope: 'portfolio', scopeKey: '', timeframe: 'daily', windowDays: 1 }

/** A move-size bar that's major for one timeframe is noise for another — a
 *  5% daily stock move is notable, a 5% yearly move isn't. 'daily' keeps
 *  the original constants above as its default; the rest are tunable. */
export const MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME: Record<PortfolioExplanationTimeframe, number> = {
  daily: MAJOR_MOVE_STOCK_PCT,
  weekly: 8,
  monthly: 15,
  yearly: 30,
  custom: 20,
}
export const MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME: Record<PortfolioExplanationTimeframe, number> = {
  daily: MAJOR_MOVE_PORTFOLIO_PCT,
  weekly: 2.5,
  monthly: 5,
  yearly: 10,
  custom: 5,
}

/** The user turn seeded into the command bar when opening the explanation
 *  from the Home page teaser — shared so the teaser's click handler and the
 *  command bar's handling of it agree on the exact text. Superseded by
 *  `explanationTriggerQuestion(slot)` for the carousel's other slots; kept
 *  as the exact literal the single daily-portfolio card has always used. */
export const EXPLANATION_TRIGGER_QUESTION = 'Why is my portfolio moving?'

function timeframeLabel(timeframe: PortfolioExplanationTimeframe, windowDays: number): string {
  switch (timeframe) {
    case 'daily': return 'today'
    case 'weekly': return 'this week'
    case 'monthly': return 'this month'
    case 'yearly': return 'this year'
    case 'custom': return `over the last ${windowDays} days`
  }
}

/** The user turn seeded into the command bar for any carousel slot —
 *  generalizes EXPLANATION_TRIGGER_QUESTION, which remains the exact
 *  literal this produces for DAILY_PORTFOLIO_SLOT. */
export function explanationTriggerQuestion(slot: PortfolioInsightSlot): string {
  const when = timeframeLabel(slot.timeframe, slot.windowDays)
  if (slot.scope === 'stock') return `Why did ${slot.scopeKey} move ${when}?`
  if (slot.scope === 'sector') return `Why did my ${slot.scopeKey} holdings move ${when}?`
  return slot.timeframe === 'daily' ? 'Why is my portfolio moving?' : `Why is my portfolio moving ${when}?`
}

export interface SymbolMove {
  symbol: string
  name: string
  dollarChange: number
  percentChange: number
  themes: string[]
  crypto?: boolean
  /** The whole position was bought inside this window, so the move is the
   *  position's return since purchase rather than the asset's move over the
   *  full window. */
  sinceBuy?: boolean
}

export interface MoversResult {
  movers: PortfolioExplanationMover[]
  dayChangeDollars: number
  dayChangePercent: number
  hasMajorMove: boolean
  isBroadMarketMove: boolean
  themeMoves: PortfolioExplanationThemeMove[]
}

function tickerThemeNames(asset: any): string[] {
  const raw = (asset.ticker?.ticker_themes ?? [])
    .map((tt: any) => String(tt?.theme?.name ?? '').trim())
    .filter((name: string) => name.length > 0)
  return Array.from(new Set<string>(raw))
}

/** One entry per distinct stock symbol. The same ticker held in several
 *  accounts is aggregated into one position (dollar moves summed, percent is
 *  the position's return = Σ move ÷ Σ start value) so it isn't double-counted
 *  for breadth/theme detection. Measured on what was held: a lot bought today
 *  counts from its purchase price (see computeDailyPosition). */
function computeSymbolMoves(assets: any[]): SymbolMove[] {
  const acc = new Map<string, { move: SymbolMove; rawDollarChange: number; startValue: number; allBoughtToday: boolean }>()
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const symbol = asset.ticker?.symbol
    if (!symbol) continue
    const shares = computeShareCount(asset)
    if (shares <= 0) continue
    const position = computeDailyPosition(asset)
    if (!position) continue
    // Per-asset cents rounding, so the sum matches Home's hero (a sum of
    // computeDailyChange's rounded per-asset figures).
    const dollarChange = Math.round(position.dollarChange * 100) / 100

    const existing = acc.get(symbol)
    if (existing) {
      existing.move.dollarChange += dollarChange
      existing.rawDollarChange += position.dollarChange
      existing.startValue += position.startValue
      existing.allBoughtToday = existing.allBoughtToday && position.allBoughtToday
      continue
    }
    acc.set(symbol, {
      move: {
        symbol,
        name: String(asset.name ?? symbol),
        dollarChange,
        percentChange: 0,
        themes: tickerThemeNames(asset),
        ...(asset.asset_type === 'Crypto' ? { crypto: true } : {}),
      },
      rawDollarChange: position.dollarChange,
      startValue: position.startValue,
      allBoughtToday: position.allBoughtToday,
    })
  }
  return [...acc.values()].map(({ move, rawDollarChange, startValue, allBoughtToday }) => ({
    ...move,
    percentChange: (rawDollarChange * 100) / startValue,
    ...(allBoughtToday ? { sinceBuy: true } : {}),
  }))
}

function detectThemeMoves(symbolMoves: SymbolMove[]): PortfolioExplanationThemeMove[] {
  const byTheme = new Map<string, SymbolMove[]>()
  for (const move of symbolMoves) {
    for (const theme of move.themes) {
      if (!byTheme.has(theme)) byTheme.set(theme, [])
      byTheme.get(theme)!.push(move)
    }
  }

  const result: PortfolioExplanationThemeMove[] = []
  for (const [theme, members] of byTheme) {
    if (members.length < BROAD_MOVE_MIN_POSITIONS) continue
    const avgPercentChange = members.reduce((sum, m) => sum + m.percentChange, 0) / members.length
    const direction: 'up' | 'down' = avgPercentChange >= 0 ? 'up' : 'down'
    const agreeing = members.filter(m =>
      Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === Math.sign(avgPercentChange),
    )
    if (agreeing.length / members.length < BROAD_MOVE_MAJORITY) continue
    result.push({
      theme,
      direction,
      avgPercentChange: Math.round(avgPercentChange * 100) / 100,
      memberSymbols: members.map(m => m.symbol),
      ...(members.every(m => m.crypto) ? { crypto: true } : {}),
    })
  }
  return result
}

/** Given `history` (one ticker's price points, sorted ascending by date),
 *  finds the closest recorded price at least `days` old — the anchor for a
 *  weekly/monthly/yearly/custom move, playing the role `previous_close`
 *  plays for the daily case. Returns null when there's no point old enough
 *  yet (a new ticker, or one added before ticker_price_history existed) —
 *  the caller simply excludes that symbol from this window, which is what
 *  makes longer-timeframe cards phase in gradually as history accumulates. */
function findPriceApproxNDaysAgo(history: TickerPricePoint[], days: number): number | null {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  let candidate: TickerPricePoint | null = null
  for (const point of history) {
    if (point.date > cutoffStr) break
    candidate = point
  }
  return candidate ? candidate.price : null
}

/** ISO date (YYYY-MM-DD) `days` ago — the start of a rolling window, the same
 *  cutoff findPriceApproxNDaysAgo anchors on. */
function windowStartDate(days: number): string {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff.toISOString().split('T')[0]
}

/** Same shape as computeSymbolMoves, but for a weekly/monthly/yearly/custom
 *  window, measured on what the user actually *held* rather than on the asset:
 *  each tax lot contributes `units × (currentPrice − anchor)`, where the anchor
 *  is the ticker's price when the window began for a lot bought before it, but
 *  the lot's own cost price for a lot bought *inside* the window (those units
 *  didn't exist in the portfolio for the earlier part of the window, so the
 *  price move before purchase isn't the portfolio's move — a coin up 158% this
 *  week is a 0% week for a position opened at today's price). A symbol's
 *  percent is its position return over the window (Σ gain ÷ Σ start value).
 *
 *  A holding that has a lot older than the window but no history point old
 *  enough for `days` is excluded, same as computeSymbolMoves excluding a stock
 *  with no previous_close — which is what phases longer-timeframe cards in as
 *  history accumulates. A position whose lots were *all* bought inside the
 *  window needs no history at all. A lot with no purchase date is treated as
 *  held for the whole window. Kept separate from computeSymbolMoves (rather
 *  than parameterizing it) so the well-tested daily path is never at risk of
 *  a regression from this generalization. */
function computeSymbolMovesForWindow(assets: any[], priceHistory: Map<string, TickerPricePoint[]>, days: number): SymbolMove[] {
  const startDate = windowStartDate(days)
  const acc = new Map<string, { move: SymbolMove; startValue: number; allLotsInWindow: boolean }>()
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    const symbol = asset.ticker?.symbol
    const tickerId = asset.ticker?.id
    if (!symbol || !tickerId) continue
    const currentPrice = Number(asset.ticker?.current_price)
    if (!Number.isFinite(currentPrice)) continue

    const lots = (asset.stock_subtypes ?? [])
      .flatMap((st: any) => st.transactions ?? [])
      .map((t: any) => ({
        units: netCount(t),
        costPrice: Number(t.cost_price),
        inWindow: typeof t.purchase_date === 'string' && t.purchase_date > startDate,
      }))
      .filter((lot: { units: number }) => lot.units > 0)
    if (lots.length === 0) continue

    const needsHistory = lots.some((lot: { inWindow: boolean }) => !lot.inWindow)
    const priceThen = needsHistory ? findPriceApproxNDaysAgo(priceHistory.get(tickerId) ?? [], days) : null
    if (needsHistory && (priceThen == null || priceThen <= 0)) continue

    let dollarChange = 0
    let startValue = 0
    for (const lot of lots) {
      // A lot bought in the window with no usable cost basis contributes no
      // move (anchored at today's price) rather than a fabricated one.
      const anchor = lot.inWindow ? (lot.costPrice > 0 ? lot.costPrice : currentPrice) : (priceThen as number)
      dollarChange += lot.units * (currentPrice - anchor)
      startValue += lot.units * anchor
    }
    if (startValue <= 0) continue

    const allLotsInWindow = !needsHistory
    const existing = acc.get(symbol)
    if (existing) {
      existing.move.dollarChange += dollarChange
      existing.startValue += startValue
      existing.allLotsInWindow = existing.allLotsInWindow && allLotsInWindow
      continue
    }
    acc.set(symbol, {
      move: {
        symbol,
        name: String(asset.name ?? symbol),
        dollarChange,
        percentChange: 0,
        themes: tickerThemeNames(asset),
        ...(asset.asset_type === 'Crypto' ? { crypto: true } : {}),
      },
      startValue,
      allLotsInWindow,
    })
  }
  return [...acc.values()].map(({ move, startValue, allLotsInWindow }) => ({
    ...move,
    percentChange: (move.dollarChange / startValue) * 100,
    ...(allLotsInWindow ? { sinceBuy: true } : {}),
  }))
}

/** The core attribution pass, shared by every timeframe: ranks movers, and
 *  derives both the theme-cluster and whole-market breadth signals from the
 *  same per-symbol data — see CLAUDE.md's token-efficiency notes for why
 *  each tier only fires (or fetches supporting news) when its own condition
 *  is met. `stockPct`/`portfolioPct` are the timeframe-scaled "major move"
 *  bars (see MAJOR_MOVE_*_PCT_BY_TIMEFRAME). */
function attributeMoves(symbolMoves: SymbolMove[], netWorth: number, stockPct: number, portfolioPct: number): MoversResult {
  const dayChangeDollars = Math.round(symbolMoves.reduce((sum, m) => sum + m.dollarChange, 0) * 100) / 100
  const dayChangePercent = netWorth > 0 ? (dayChangeDollars / netWorth) * 100 : 0

  const totalAbsSwing = symbolMoves.reduce((sum, m) => sum + Math.abs(m.dollarChange), 0)
  const ranked = [...symbolMoves].sort((a, b) => Math.abs(b.dollarChange) - Math.abs(a.dollarChange))

  const themeMoves = detectThemeMoves(symbolMoves)
  const themeMemberSymbols = new Set(themeMoves.flatMap(t => t.memberSymbols))

  const overallDirection = Math.sign(dayChangeDollars)
  const agreeingWithOverall = symbolMoves.filter(m =>
    overallDirection !== 0 && Math.abs(m.percentChange) >= NOISE_BAND_PCT && Math.sign(m.percentChange) === overallDirection,
  )
  const isBroadMarketMove =
    symbolMoves.length >= BROAD_MOVE_MIN_POSITIONS &&
    overallDirection !== 0 &&
    agreeingWithOverall.length / symbolMoves.length >= BROAD_MOVE_MAJORITY

  // Top movers by $ contribution, covering the coverage target (capped),
  // widened to include every member of a flagged theme cluster so a theme
  // mention always has constituent numbers to show on click.
  const selected: SymbolMove[] = []
  let coveredAbs = 0
  for (const move of ranked) {
    if (selected.length >= MAX_MOVERS) break
    selected.push(move)
    coveredAbs += Math.abs(move.dollarChange)
    if (coveredAbs / (totalAbsSwing || 1) >= MOVER_COVERAGE_TARGET) break
  }
  // Widen beyond the cap/coverage cutoff to include every member of a
  // flagged theme cluster, so a theme mention always has constituent
  // numbers to show on click (see CLAUDE.md).
  const selectedSymbols = new Set(selected.map(m => m.symbol))
  for (const move of ranked) {
    if (themeMemberSymbols.has(move.symbol) && !selectedSymbols.has(move.symbol)) {
      selected.push(move)
      selectedSymbols.add(move.symbol)
    }
  }

  const themeBySymbol = new Map<string, string>()
  for (const t of themeMoves) {
    for (const symbol of t.memberSymbols) if (!themeBySymbol.has(symbol)) themeBySymbol.set(symbol, t.theme)
  }

  const movers: PortfolioExplanationMover[] = selected.map(move => ({
    symbol: move.symbol,
    name: move.name,
    dollarChange: Math.round(move.dollarChange * 100) / 100,
    percentChange: Math.round(move.percentChange * 100) / 100,
    contributionPct: totalAbsSwing > 0 ? Math.round((Math.abs(move.dollarChange) / totalAbsSwing) * 1000) / 10 : 0,
    ...(themeBySymbol.has(move.symbol) ? { theme: themeBySymbol.get(move.symbol) } : {}),
    ...(move.crypto ? { crypto: true } : {}),
    ...(move.sinceBuy ? { sinceBuy: true } : {}),
    headlines: [],
  }))

  const hasMajorMove =
    movers.some(m => Math.abs(m.percentChange) >= moveBar(stockPct, m.crypto)) ||
    Math.abs(dayChangePercent) >= portfolioPct

  return { movers, dayChangeDollars, dayChangePercent, hasMajorMove, isBroadMarketMove, themeMoves }
}

/** The daily basis — current price vs. previous_close, summed. Unchanged
 *  from before this file gained other timeframes; every existing caller
 *  (Home's hero/Daily Movers, the Portfolio Pulse teaser) keeps working
 *  exactly as documented in CLAUDE.md. */
export function computeMovers(assets: any[], netWorth: number): MoversResult {
  return attributeMoves(computeSymbolMoves(assets), netWorth, MAJOR_MOVE_STOCK_PCT, MAJOR_MOVE_PORTFOLIO_PCT)
}

/** The weekly/monthly/yearly/custom basis — same attribution pipeline as
 *  computeMovers, sourced from `priceHistory` (see getTickerPriceHistory)
 *  instead of previous_close, with move-size bars scaled to the timeframe. */
export function computeMoversForWindow(
  assets: any[],
  netWorth: number,
  priceHistory: Map<string, TickerPricePoint[]>,
  windowDays: number,
  timeframe: PortfolioExplanationTimeframe,
): MoversResult {
  return attributeMoves(
    computeSymbolMovesForWindow(assets, priceHistory, windowDays),
    netWorth,
    MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME[timeframe],
    MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME[timeframe],
  )
}

/** Calendar-day key used as a (deliberately simple) stand-in for "which
 *  market session are we in" — the same UTC-date granularity already used
 *  elsewhere in this app for "daily" things (net_worth_snapshots.date,
 *  tickers.last_updated), not a timezone-aware NYSE-open calculation. */
export function todayMarketDate(): string {
  return new Date().toISOString().split('T')[0]
}

/** The set of holdings crossing the individual-mover bar — the "stock
 *  level" for staleness/change comparisons below. Works the same whether
 *  fed a fresh MoversResult.movers or a stored row's movers, since both
 *  are PortfolioExplanationMover[]. `stockPct` defaults to the daily bar so
 *  every existing (2-arg) call site keeps its exact prior behavior; callers
 *  working with a weekly/monthly/yearly/custom MoversResult should pass the
 *  matching MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME entry instead. */
function significantMoverSymbols(movers: PortfolioExplanationMover[], stockPct: number = MAJOR_MOVE_STOCK_PCT): Set<string> {
  return new Set(movers.filter(m => Math.abs(m.percentChange) >= moveBar(stockPct, m.crypto)).map(m => m.symbol))
}

/** Same idea for theme moves — detectThemeMoves' own clustering condition
 *  isn't magnitude-aware (it only checks member agreement), so this is what
 *  keeps "did the flagged-theme set change" from firing on a theme whose
 *  average move is too small to matter at this timeframe. */
function significantThemeNames(themeMoves: { theme: string; avgPercentChange: number; crypto?: boolean }[], stockPct: number = MAJOR_MOVE_STOCK_PCT): Set<string> {
  return new Set(themeMoves.filter(t => Math.abs(t.avgPercentChange) >= moveBar(stockPct, t.crypto)).map(t => t.theme))
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/** Whether it's worth spending another LLM call given what's already
 *  stored — checked at three independent levels, any one of which is
 *  enough on its own (see CLAUDE.md):
 *  - market day: the stored explanation is from a prior market session
 *    (reset every market open) regardless of how the numbers compare. Only
 *    applies when `resetsDaily` is true (the default) — a rolling
 *    weekly/monthly/yearly/custom window has no such discrete boundary and
 *    relies on the checks below alone (see generatePortfolioExplanation).
 *  - portfolio: today's aggregate swing has moved meaningfully past what's
 *    stored, or flipped sign (REGENERATION_HYSTERESIS_PCT).
 *  - stock / sector: the *set* of individually-significant movers, or of
 *    flagged theme moves, differs from what's stored — a new holding or
 *    sector joining the story (or one dropping out of it) is a change
 *    even if the aggregate swing happens to look similar.
 *  A `force` regenerate bypasses this entirely (see
 *  generatePortfolioExplanation). */
export function shouldRegenerate(
  current: MoversResult,
  last: PortfolioExplanationRow | null,
  resetsDaily: boolean = true,
  stockPct: number = MAJOR_MOVE_STOCK_PCT,
): boolean {
  if (!last) return true
  if (resetsDaily && last.market_date !== todayMarketDate()) return true

  const prevPct = Number(last.day_change_percent ?? 0)
  const currPct = current.dayChangePercent
  const signFlipped = prevPct !== 0 && currPct !== 0 && Math.sign(prevPct) !== Math.sign(currPct)
  if (signFlipped || Math.abs(currPct - prevPct) >= REGENERATION_HYSTERESIS_PCT) return true

  if (!setsEqual(significantMoverSymbols(current.movers, stockPct), significantMoverSymbols(last.movers ?? [], stockPct))) return true
  if (!setsEqual(significantThemeNames(current.themeMoves, stockPct), significantThemeNames(last.theme_moves ?? [], stockPct))) return true

  return false
}

function fmtDollars(n: number): string {
  const sign = n >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function fmtPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** The "nothing to report" case — zero tokens, zero news calls. */
export function buildStaticNoMoveSummary(dayChangeDollars: number, dayChangePercent: number): string {
  if (Math.abs(dayChangeDollars) < 1) {
    return 'No major moves today — your portfolio held steady.'
  }
  return `No major moves today — your portfolio was ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}), within normal day-to-day movement.`
}

/** The portfolio-scope teaser for any timeframe — one-line hook, entirely
 *  deterministic (no LLM call), built straight from a MoversResult (daily
 *  via computeMovers, or weekly/monthly/yearly/custom via
 *  computeMoversForWindow). Returns null when there's nothing worth
 *  surfacing (`hasMajorMove` false).
 *
 *  When `previous` is comparable (same market day for 'daily'; any prior
 *  row for a rolling window, since those have no discrete reset point) and
 *  is now stale (shouldRegenerate), the wording calls out specifically
 *  what's new since it was generated — a new sector, a new mover, or (if
 *  neither) just the changed swing. Otherwise (first check, or nothing's
 *  changed) picks whichever generic framing fits, in the same priority
 *  order as the "what's new" branch so sector gets equal first-class
 *  treatment either way:
 *  - one holding dominates the swing → name it directly ("CRM moved …")
 *  - a sector/theme move was flagged → name it ("Your Semiconductors
 *    holdings moved …"), picking the theme with the largest average move
 *    when more than one is flagged
 *  - several holdings individually crossed the per-stock bar → count them
 *  - otherwise it's the aggregate swing carrying the story on its own */
function buildPortfolioTeaser(
  result: MoversResult,
  timeframe: PortfolioExplanationTimeframe,
  windowDays: number,
  previous?: PortfolioExplanationRow | null,
): string | null {
  if (!result.hasMajorMove) return null

  const when = timeframeLabel(timeframe, windowDays)
  const resetsDaily = timeframe === 'daily'
  const stockPct = MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME[timeframe]

  const comparablePrevious = previous && (!resetsDaily || previous.market_date === todayMarketDate()) ? previous : null
  if (comparablePrevious && shouldRegenerate(result, comparablePrevious, resetsDaily, stockPct)) {
    const newThemes = [...significantThemeNames(result.themeMoves, stockPct)].filter(t => !significantThemeNames(comparablePrevious.theme_moves ?? [], stockPct).has(t))
    if (newThemes.length > 0) {
      return `New activity in ${newThemes.join(', ')} since your last check. Want an updated explanation?`
    }
    const newSymbols = [...significantMoverSymbols(result.movers, stockPct)].filter(s => !significantMoverSymbols(comparablePrevious.movers ?? [], stockPct).has(s))
    if (newSymbols.length > 0) {
      return `${newSymbols.join(', ')} just moved. Want an updated explanation?`
    }
    return `Your portfolio's move has changed since your last check. Want an updated explanation?`
  }

  const significantMovers = result.movers.filter(m => Math.abs(m.percentChange) >= moveBar(stockPct, m.crypto))
  const dominant = significantMovers.length === 1 && significantMovers[0].contributionPct >= DOMINANT_MOVER_CONTRIBUTION_PCT
    ? significantMovers[0]
    : null

  if (dominant) {
    return dominant.sinceBuy
      ? `${dominant.symbol} moved ${fmtPercent(dominant.percentChange)} since you bought it. Want to know why?`
      : `${dominant.symbol} moved ${fmtPercent(dominant.percentChange)} ${when}. Want to know why?`
  }
  if (result.themeMoves.length > 0) {
    const primaryTheme = [...result.themeMoves].sort((a, b) => Math.abs(b.avgPercentChange) - Math.abs(a.avgPercentChange))[0]
    // This card opens the *portfolio-wide* question, so lead with the
    // portfolio and only name the sector as context — a "Your X holdings
    // moved…" opener reads as a sector card and the tap seemed to open the
    // wrong session. Sector moves get their own card.
    const dir = result.dayChangeDollars >= 0 ? 'up' : 'down'
    return `Your portfolio went ${dir} ${Math.abs(result.dayChangePercent).toFixed(2)}% ${when}, with ${primaryTheme.theme} moving the most. Want to know why?`
  }
  if (significantMovers.length >= 2) {
    return `${significantMovers.length} items in your portfolio moved substantially ${when}. Want to know why?`
  }
  const direction = result.dayChangeDollars >= 0 ? 'up' : 'down'
  return `Your portfolio went ${direction} ${Math.abs(result.dayChangePercent).toFixed(2)}% ${when}. Want to know why?`
}

/** The Home page card's one-line hook for the daily portfolio-wide slot —
 *  kept as the exact literal wrapper it's always been (`buildPortfolioTeaser`
 *  with `timeframe: 'daily'` reproduces its output byte-for-byte); see
 *  `buildSlotTeaser` for the carousel's other slots. */
export function buildTeaser(result: MoversResult, previous?: PortfolioExplanationRow | null): string | null {
  return buildPortfolioTeaser(result, 'daily', 1, previous)
}

/** Narrows a whole-portfolio MoversResult down to just one slot's own
 *  story — same shape, so every downstream step (shouldRegenerate, the
 *  hasMajorMove branch, prompt building, storage, the teaser) treats every
 *  scope uniformly. Assumes (for 'stock'/'sector') that `scopeKey` already
 *  appears in `result.movers`/`result.themeMoves` — true for any slot
 *  produced by `computeCandidateSlots`, since slots are derived from this
 *  same computeMovers/computeMoversForWindow output. */
export function scopeMoversResult(result: MoversResult, slot: PortfolioInsightSlot): MoversResult {
  if (slot.scope === 'portfolio') return result

  if (slot.scope === 'stock') {
    const mover = result.movers.find(m => m.symbol === slot.scopeKey)
    return {
      movers: mover ? [mover] : [],
      themeMoves: [],
      hasMajorMove: !!mover,
      isBroadMarketMove: false,
      dayChangeDollars: mover?.dollarChange ?? 0,
      dayChangePercent: mover?.percentChange ?? 0,
    }
  }

  const theme = result.themeMoves.find(t => t.theme === slot.scopeKey)
  const members = result.movers.filter(m => m.theme === slot.scopeKey)
  return {
    movers: members,
    themeMoves: theme ? [theme] : [],
    hasMajorMove: !!theme,
    isBroadMarketMove: false,
    dayChangeDollars: Math.round(members.reduce((sum, m) => sum + m.dollarChange, 0) * 100) / 100,
    dayChangePercent: theme?.avgPercentChange ?? 0,
  }
}

/** The Portfolio Pulse carousel's one-line hook for any slot — the
 *  scope-aware counterpart to `buildTeaser` (which remains the exact
 *  DAILY_PORTFOLIO_SLOT case: `buildSlotTeaser(DAILY_PORTFOLIO_SLOT, result,
 *  previous) === buildTeaser(result, previous)`). Narrows `fullResult` to
 *  the slot's own story via `scopeMoversResult` first. */
export function buildSlotTeaser(slot: PortfolioInsightSlot, fullResult: MoversResult, previous?: PortfolioExplanationRow | null): string | null {
  const scoped = scopeMoversResult(fullResult, slot)
  if (!scoped.hasMajorMove) return null

  if (slot.scope === 'portfolio') return buildPortfolioTeaser(scoped, slot.timeframe, slot.windowDays, previous)

  const when = timeframeLabel(slot.timeframe, slot.windowDays)
  const resetsDaily = slot.timeframe === 'daily'
  const comparablePrevious = previous && (!resetsDaily || previous.market_date === todayMarketDate()) ? previous : null
  const stale = comparablePrevious && shouldRegenerate(scoped, comparablePrevious, resetsDaily, MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME[slot.timeframe])

  if (slot.scope === 'stock') {
    const mover = scoped.movers[0]
    if (!mover) return null
    return stale
      ? `${mover.symbol} just moved again ${when}. Want an updated explanation?`
      : mover.sinceBuy
        ? `${mover.symbol} moved ${fmtPercent(mover.percentChange)} since you bought it. Want to know why?`
        : `${mover.symbol} moved ${fmtPercent(mover.percentChange)} ${when}. Want to know why?`
  }

  const theme = scoped.themeMoves[0]
  if (!theme) return null
  return stale
    ? `Your ${theme.theme} holdings kept moving ${when}. Want an updated explanation?`
    : `Your ${theme.theme} holdings moved ${theme.direction} ${Math.abs(theme.avgPercentChange).toFixed(2)}% ${when}. Want to know why?`
}

/** Non-calendar windows scanned for the "notable move" catch-all in
 *  computeCandidateSlots — filling the gap when a slow-playing-out move
 *  (e.g. a stock up over 60 days on news that took a while to land) doesn't
 *  line up with any of the fixed daily/weekly/monthly/yearly buckets. */
export const CUSTOM_WINDOW_DAYS = [14, 45, 60, 90, 120, 180, 270]

function deriveSlotsFromResult(result: MoversResult, timeframe: PortfolioExplanationTimeframe, windowDays: number): PortfolioInsightSlot[] {
  const stockPct = MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME[timeframe]
  const portfolioPct = MAJOR_MOVE_PORTFOLIO_PCT_BY_TIMEFRAME[timeframe]
  const slots: PortfolioInsightSlot[] = []
  if (Math.abs(result.dayChangePercent) >= portfolioPct) {
    slots.push({ scope: 'portfolio', scopeKey: '', timeframe, windowDays })
  }
  for (const m of result.movers) {
    if (Math.abs(m.percentChange) >= moveBar(stockPct, m.crypto)) slots.push({ scope: 'stock', scopeKey: m.symbol, timeframe, windowDays })
  }
  for (const t of result.themeMoves) {
    if (Math.abs(t.avgPercentChange) >= moveBar(stockPct, t.crypto)) slots.push({ scope: 'sector', scopeKey: t.theme, timeframe, windowDays })
  }
  return slots
}

/** Every currently-relevant Portfolio Pulse carousel slot, across all three
 *  scopes (stock/sector/portfolio) and every timeframe (daily/weekly/
 *  monthly/yearly, plus a "notable move" catch-all over CUSTOM_WINDOW_DAYS)
 *  — the carousel renders exactly this list, nothing when it's empty,
 *  auto-advancing through whichever insights are live right now.
 *  `priceHistory` should cover at least a year back (see
 *  getTickerPriceHistory) so every pass below has what it needs from one
 *  shared fetch. */
export function computeCandidateSlots(assets: any[], netWorth: number, priceHistory: Map<string, TickerPricePoint[]>): PortfolioInsightSlot[] {
  const daily = computeMovers(assets, netWorth)
  const weekly = computeMoversForWindow(assets, netWorth, priceHistory, 7, 'weekly')
  const monthly = computeMoversForWindow(assets, netWorth, priceHistory, 30, 'monthly')
  const yearly = computeMoversForWindow(assets, netWorth, priceHistory, 365, 'yearly')

  const slots = [
    ...deriveSlotsFromResult(daily, 'daily', 1),
    ...deriveSlotsFromResult(weekly, 'weekly', 7),
    ...deriveSlotsFromResult(monthly, 'monthly', 30),
    ...deriveSlotsFromResult(yearly, 'yearly', 365),
  ]

  // "Notable move" catch-all: a stock/sector whose move over some
  // non-calendar window stands out even though it doesn't cross the bar at
  // any fixed calendar bucket above. Skips anything already covered by a
  // slot above, and keeps at most the two most extreme finds (by
  // magnitude, deduped per symbol/theme) so the carousel doesn't fill up
  // with near-duplicate long-window variants of the same story.
  const covered = new Set(slots.filter(s => s.scope !== 'portfolio').map(s => `${s.scope}:${s.scopeKey}`))
  const customStockPct = MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME.custom
  const found = new Map<string, { slot: PortfolioInsightSlot; magnitude: number }>()
  for (const windowDays of CUSTOM_WINDOW_DAYS) {
    const windowResult = computeMoversForWindow(assets, netWorth, priceHistory, windowDays, 'custom')
    for (const m of windowResult.movers) {
      const key = `stock:${m.symbol}`
      if (covered.has(key) || Math.abs(m.percentChange) < moveBar(customStockPct, m.crypto)) continue
      const existing = found.get(key)
      if (!existing || Math.abs(m.percentChange) > existing.magnitude) {
        found.set(key, { slot: { scope: 'stock', scopeKey: m.symbol, timeframe: 'custom', windowDays }, magnitude: Math.abs(m.percentChange) })
      }
    }
    for (const t of windowResult.themeMoves) {
      const key = `sector:${t.theme}`
      if (covered.has(key) || Math.abs(t.avgPercentChange) < moveBar(customStockPct, t.crypto)) continue
      const existing = found.get(key)
      if (!existing || Math.abs(t.avgPercentChange) > existing.magnitude) {
        found.set(key, { slot: { scope: 'sector', scopeKey: t.theme, timeframe: 'custom', windowDays }, magnitude: Math.abs(t.avgPercentChange) })
      }
    }
  }
  const topCustom = [...found.values()].sort((a, b) => b.magnitude - a.magnitude).slice(0, 2).map(c => c.slot)

  // One card per subject (a given stock, sector, or the portfolio itself):
  // the same subject crossing its bar at several timeframes would otherwise
  // show up as near-identical duplicate cards. Order above is daily →
  // weekly → monthly → yearly → custom, so the first hit is the shortest
  // (most current) timeframe.
  const seen = new Set<string>()
  return [...slots, ...topCustom].filter(s => {
    const key = `${s.scope}:${s.scopeKey}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** `timeWord` defaults to 'daily' so the exported constant below (still
 *  used wherever a slot isn't threaded through) reads exactly as before. */
/** If the model hit its token cap, drop the dangling fragment so the reply
 *  ends on a full sentence rather than mid-thought. */
export function trimToLastSentence(text: string, finishReason?: string | null): string {
  if (!text || (finishReason !== 'length' && finishReason !== 'max_tokens')) return text
  const idx = Math.max(text.lastIndexOf('. '), text.lastIndexOf('.\n'), /[.!?]$/.test(text) ? text.length - 1 : -1)
  return idx > 0 ? text.slice(0, idx + 1) : text
}

export function explanationSystemPrompt(timeWord: string = 'daily'): string {
  return `You explain a user's investment portfolio's ${timeWord} performance in plain English.
Rules:
- Use ONLY the facts given below. Never invent a cause, headline, or number.
- Write 2-4 sentences, no preamble, no markdown.
- Mention specific ticker symbols and theme names by name where relevant (so the app can highlight them) — don't paraphrase them away.
- If headlines are provided for a mover or the market, briefly weave in the likely cause. If none are provided for something, say plainly that no news was found for it and report the numbers — never imply or guess a cause.
- The reader may not know every holding: when you mention a company or fund, say what it is in a few words (e.g. "CleanSpark, a bitcoin miner"), using only the name/theme given below.
- Lead with the current state of the move in plain terms; avoid "flipped"/"reversal from the earlier reading" phrasing unless it actually helps the reader understand.
- Distinguish company-specific moves from theme-wide or broad-market moves when the facts show that pattern.
- If an earlier update covering the same period is given, this is a refresh of it, not a brand new answer: keep whatever from it is still relevant (don't silently drop a still-current position or theme just because it isn't repeated below), and clearly work in what's new. Don't just concatenate the two — write one coherent update. If something from the earlier update is no longer reflected in the facts below, drop it.`
}
export const EXPLANATION_SYSTEM_PROMPT = explanationSystemPrompt()

export function buildExplanationUserPrompt(
  movers: PortfolioExplanationMover[],
  dayChangeDollars: number,
  dayChangePercent: number,
  themeMoves: PortfolioExplanationThemeMove[],
  marketHeadlines: PortfolioExplanationHeadline[],
  previousSummary?: string,
  label: string = 'Portfolio day change',
  swingWord: string = "today's",
  previousLabel: string = 'Earlier update from today',
): string {
  const lines: string[] = []
  if (previousSummary) {
    lines.push(`${previousLabel}: "${previousSummary}"`)
    lines.push('')
    lines.push('Current facts (may supersede parts of the earlier update):')
  }
  lines.push(`${label}: ${fmtDollars(dayChangeDollars)} (${fmtPercent(dayChangePercent)}).`)

  lines.push('Movers:')
  for (const m of movers) {
    const headlineText = m.headlines.length
      ? ` Headlines: ${m.headlines.map(h => `"${h.title}" (${h.source})`).join('; ')}`
      : ''
    const sinceBuyNote = m.sinceBuy ? ' [the user bought this during the period, so this is their return since purchase, not the asset\'s move over the whole period]' : ''
    lines.push(`- ${m.symbol} (${m.name}): ${fmtDollars(m.dollarChange)} (${fmtPercent(m.percentChange)})${sinceBuyNote}, ${m.contributionPct}% of ${swingWord} swing.${headlineText}`)
  }

  if (themeMoves.length > 0) {
    lines.push('Theme moves:')
    for (const t of themeMoves) {
      lines.push(`- ${t.theme}: ${t.memberSymbols.length} holdings moved ${t.direction} together, avg ${fmtPercent(t.avgPercentChange)} (${t.memberSymbols.join(', ')}).`)
    }
  }

  if (marketHeadlines.length > 0) {
    lines.push('Market context:')
    for (const h of marketHeadlines) {
      lines.push(`- "${h.title}" (${h.source})`)
    }
  }

  return lines.join('\n')
}

/** Strips a trailing "\n\nSources:\n..." block off a summary, if present.
 *  Headline links are no longer appended to newly-generated summaries at
 *  all (see CommandBar.tsx's ExplanationMessageContent — links now live in
 *  the per-mover/theme detail panel and the market-context list, both
 *  driven by the row's structured movers/theme_moves/market_headlines,
 *  never by parsing the prose). This only exists to (a) strip a stale
 *  Sources block off a summary generated by an older version of this file
 *  before it's shown or fed back to the LLM as prior-context, and (b)
 *  strip prior-context before re-feeding it forward — a summary's own
 *  links are always rebuilt fresh from the current headline set anyway. */
export function stripSources(summary: string): string {
  return summary.split(/\n\nSources:\n/)[0]
}

function trimHeadlines(raw: any[], limit: number): PortfolioExplanationHeadline[] {
  return raw
    .filter(a => a && a.headline)
    .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
    .slice(0, limit)
    .map(a => ({ title: String(a.headline), source: String(a.source ?? ''), url: String(a.url ?? ''), datetime: Number(a.datetime ?? 0) }))
}

/** Keeps only news items whose headline/summary names the coin — by its full
 *  name ("Bitcoin") or its ticker as a standalone uppercase word ("BTC"),
 *  so a short symbol like "ETH" doesn't match inside "method". Exported for
 *  tests. */
export function filterNewsForCoin(raw: any[], symbol: string, name: string): any[] {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const nameRe = name && name.toUpperCase() !== symbol.toUpperCase()
    ? new RegExp(`\\b${escape(name)}\\b`, 'i')
    : null
  const symbolRe = new RegExp(`\\b${escape(symbol.toUpperCase())}\\b`)
  return raw.filter(item => {
    const text = `${item?.headline ?? ''} ${item?.summary ?? ''}`
    return symbolRe.test(text) || (nameRe?.test(text) ?? false)
  })
}

/** Best-effort per-mover company news — only ever called for the (≤5)
 *  actual movers, never the rest of the portfolio, and only when there's a
 *  major move to explain in the first place. */
export async function fetchMoverHeadlines(
  symbols: string[],
  finnhubApiKey: string,
  windowDays: number = 7,
  cryptoNames: Map<string, string> = new Map(),
): Promise<Map<string, PortfolioExplanationHeadline[]>> {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - Math.max(7, Math.min(windowDays, 30)) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const result = new Map<string, PortfolioExplanationHeadline[]>()

  // Finnhub has no per-coin news — company-news is keyed by stock symbol and
  // a coin's symbol could match an unrelated stock. Crypto movers instead get
  // the general crypto news feed filtered down to items that actually name
  // the coin (one fetch shared across every crypto mover).
  const cryptoSymbols = symbols.filter(symbol => cryptoNames.has(symbol))
  if (cryptoSymbols.length > 0) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${finnhubApiKey}`)
      const raw = await res.json()
      if (Array.isArray(raw)) {
        for (const symbol of cryptoSymbols) {
          result.set(symbol, trimHeadlines(filterNewsForCoin(raw, symbol, cryptoNames.get(symbol) ?? symbol), 2))
        }
      }
    } catch { /* best-effort — a missing headline just means no citation for that mover */ }
  }

  await Promise.all(symbols.filter(symbol => !cryptoNames.has(symbol)).map(async (symbol) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${finnhubApiKey}`)
      const raw = await res.json()
      if (Array.isArray(raw)) result.set(symbol, trimHeadlines(raw, 2))
    } catch { /* best-effort — a missing headline just means no citation for that mover */ }
  }))
  return result
}

/** Best-effort general market news — only called when computeMovers has
 *  already flagged isBroadMarketMove, i.e. a majority of holdings moved
 *  together (see CLAUDE.md). */
export async function fetchMarketHeadlines(finnhubApiKey: string): Promise<PortfolioExplanationHeadline[]> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubApiKey}`)
    const raw = await res.json()
    return Array.isArray(raw) ? trimHeadlines(raw, 2) : []
  } catch {
    return []
  }
}

/** Slot-specific wording for the LLM prompt — '' (all defaults) for
 *  DAILY_PORTFOLIO_SLOT so that slot's prompt text is byte-for-byte
 *  unchanged from before this file supported other slots. */
function promptContextForSlot(slot: PortfolioInsightSlot): { label?: string; swingWord?: string; timeWord?: string } {
  if (slot.scope === 'portfolio' && slot.timeframe === 'daily') return {}
  const when = timeframeLabel(slot.timeframe, slot.windowDays)
  const subject = slot.scope === 'stock' ? slot.scopeKey : slot.scope === 'sector' ? `${slot.scopeKey} holdings` : 'Portfolio'
  return { label: `${subject} change ${when}`, swingWord: when, timeWord: when }
}

/** Browser-only orchestration, called only when the user asks for it (a
 *  Portfolio Pulse carousel card opening a command bar session — see
 *  CommandBar.tsx/commandBarBridge.ts): loads the portfolio, computes that
 *  slot's own move (daily via computeMovers, otherwise via
 *  computeMoversForWindow + ticker_price_history), reuses the stored
 *  explanation for this exact (scope, scope_key, timeframe) if nothing
 *  material has moved since (shouldRegenerate), otherwise regenerates —
 *  fetching supporting headlines only when there's actually something to
 *  explain. There is no background/scheduled path anymore; every call here
 *  is inherently "manual" (a user opened it), `force` exists only to bypass
 *  the cache-reuse check outright if ever needed. */
export async function generatePortfolioExplanation(slot: PortfolioInsightSlot, options: { force?: boolean } = {}): Promise<PortfolioExplanationRow> {
  const { force = false } = options
  const assets = await getAllAssets()
  const netWorth = computeTotalNetWorth(assets)

  let fullResult: MoversResult
  if (slot.timeframe === 'daily') {
    fullResult = computeMovers(assets, netWorth)
  } else {
    const tickerIds = [...new Set(
      assets.filter((a: any) => isTickerAsset(a) && a.ticker?.id).map((a: any) => a.ticker.id as string),
    )]
    // A little slack past windowDays so a ticker's oldest-available row
    // still counts as "the anchor" even if it landed a day or two late.
    const sinceDate = new Date(Date.now() - (slot.windowDays + 5) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const priceHistory = await getTickerPriceHistory(tickerIds, sinceDate)
    fullResult = computeMoversForWindow(assets, netWorth, priceHistory, slot.windowDays, slot.timeframe)
  }
  const result = scopeMoversResult(fullResult, slot)

  const existing = await getPortfolioExplanation(slot.scope, slot.scopeKey, slot.timeframe)
  // shouldRegenerate always returns true when `existing` is null, so this
  // branch is only reachable with a non-null row to fall back to.
  if (!force && existing && !shouldRegenerate(result, existing, slot.timeframe === 'daily', MAJOR_MOVE_STOCK_PCT_BY_TIMEFRAME[slot.timeframe])) {
    return existing
  }

  const marketDate = todayMarketDate()

  if (!result.hasMajorMove) {
    return upsertPortfolioExplanation({
      summary: buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent),
      has_major_moves: false,
      day_change_dollars: result.dayChangeDollars,
      day_change_percent: result.dayChangePercent,
      basis_net_worth: netWorth,
      movers: [],
      is_broad_market_move: false,
      market_headlines: [],
      theme_moves: [],
      trigger: 'manual',
      market_date: marketDate,
      scope: slot.scope,
      scope_key: slot.scopeKey,
      timeframe: slot.timeframe,
      window_days: slot.windowDays,
      input_tokens: null,
      output_tokens: null,
    })
  }

  const finnhubKey = config.finnhubApiKey
  // symbol → coin name for held crypto, so news can be matched by name.
  const cryptoNames = new Map<string, string>()
  for (const asset of assets) {
    // CoinGecko ids are slugs of the coin's name ('bitcoin', 'wrapped-bitcoin'),
    // which makes them a usable name to match headlines against.
    if (asset.asset_type === 'Crypto' && asset.ticker?.symbol) {
      cryptoNames.set(asset.ticker.symbol, String(asset.ticker.coingecko_id ?? asset.ticker.symbol).replace(/-/g, ' '))
    }
  }
  const [headlinesBySymbol, marketHeadlines] = await Promise.all([
    finnhubKey ? fetchMoverHeadlines(result.movers.map(m => m.symbol), finnhubKey, slot.windowDays, cryptoNames) : Promise.resolve(new Map<string, PortfolioExplanationHeadline[]>()),
    finnhubKey && result.isBroadMarketMove ? fetchMarketHeadlines(finnhubKey) : Promise.resolve([]),
  ])
  const movers = result.movers.map(m => ({ ...m, headlines: headlinesBySymbol.get(m.symbol) ?? [] }))

  // Carry the still-relevant parts of an earlier update for this same slot
  // forward rather than replacing it outright (see CLAUDE.md). For 'daily'
  // only within the same market day; other timeframes are rolling windows
  // with no such discrete boundary, so any existing major-move story for
  // this slot is fair game to carry forward.
  const previousSummary = existing && existing.has_major_moves && (slot.timeframe !== 'daily' || existing.market_date === marketDate)
    ? stripSources(existing.summary)
    : undefined

  const { label, swingWord, timeWord } = promptContextForSlot(slot)
  const prompt = buildExplanationUserPrompt(movers, result.dayChangeDollars, result.dayChangePercent, result.themeMoves, marketHeadlines, previousSummary, label, swingWord)
  const client = createLLMClient(config.llmProvider, config.activeApiKey)
  const model = MODEL_FOR_PROVIDER[config.llmProvider]
  const response = await client.chat.completions.create({
    model,
    max_tokens: 600,
    messages: [
      { role: 'system', content: explanationSystemPrompt(timeWord) },
      { role: 'user', content: prompt },
    ],
    ...(config.llmProvider === 'claude' ? { output_config: { effort: 'low' as const } } : {}),
  })
  // No links appended here — see stripSources' docstring. The caller
  // (CommandBar.tsx) renders movers/theme_moves/market_headlines as
  // interactive highlights + a market-context list instead.
  const summary = trimToLastSentence(response.choices[0]?.message?.content?.trim() ?? '', response.choices[0]?.finish_reason) || buildStaticNoMoveSummary(result.dayChangeDollars, result.dayChangePercent)
  const inputTokens = response.usage?.inputTokens ?? null
  const outputTokens = response.usage?.outputTokens ?? null

  const saved = await upsertPortfolioExplanation({
    summary,
    has_major_moves: true,
    day_change_dollars: result.dayChangeDollars,
    day_change_percent: result.dayChangePercent,
    basis_net_worth: netWorth,
    movers,
    is_broad_market_move: result.isBroadMarketMove,
    market_headlines: marketHeadlines,
    theme_moves: result.themeMoves,
    trigger: 'manual',
    market_date: marketDate,
    scope: slot.scope,
    scope_key: slot.scopeKey,
    timeframe: slot.timeframe,
    window_days: slot.windowDays,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  })

  void logLlmUsage({
    feature: 'portfolio_explanation',
    provider: config.llmProvider,
    model,
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  })

  return saved
}
