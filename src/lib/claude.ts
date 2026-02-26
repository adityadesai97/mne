import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/store/config'
import { getAllAssets } from './db/assets'
import { getSnapshots } from './db/snapshots'
import { getAllTickers } from './db/tickers'
import { findOrCreateLocation } from './db/locations'
import { autoAssignThemesForTickerIfEnabled } from './autoThemes'
import { computeThemeDistribution } from './charts'
import { computeAssetValue, computeCostBasis, computeTotalNetWorth, computeUnrealizedGain } from './portfolio'
import { getSupabaseClient } from './supabase'

export type Message = { role: 'user' | 'assistant'; content: string }
export type AgentTraceStep = {
  label: string
  detail?: string
}
export type AgentTrace = {
  generatedAt: string
  steps: AgentTraceStep[]
}

function clipText(value: unknown, maxLength = 220): string {
  let text = ''
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value ?? '')
    }
  }
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

async function fetchAndStorePrice(tickerId: string, symbol: string): Promise<void> {
  if (!config.finnhubApiKey) return
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${config.finnhubApiKey}`)
    const quote = await res.json()
    if (quote.c) {
      await getSupabaseClient().from('tickers').update({
        current_price: quote.c,
        last_updated: new Date().toISOString().split('T')[0],
      }).eq('id', tickerId)
    }
  } catch { /* best effort */ }
}

function isSaleUtterance(text: string): boolean {
  const normalized = text.toLowerCase()
  return /\b(sell|sold)\b/.test(normalized) && /\bshare(s)?\b/.test(normalized)
}

function mentionsTransferIntent(text: string): boolean {
  const normalized = text.toLowerCase()
  return /\b(transfer|moved?|move|deposit(?:ed)?|put)\b/.test(normalized) && /\b(proceed|cash|401k|account|to)\b/.test(normalized)
}

function isTransferProceedsPrompt(text: string): boolean {
  return /transfer the sale proceeds/i.test(text)
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function isAnalyticalQuestion(text: string): boolean {
  const normalized = text.toLowerCase()
  return /\b(what if|impact|implication|analy[sz]e|analysis|how would|what happens|affect|allocation|exposure|concentration|risk|scenario|if i buy|if i sell)\b/.test(normalized)
}

function extractTickerCandidates(query: string): string[] {
  const stopWords = new Set([
    'A',
    'AN',
    'AND',
    'ARE',
    'AS',
    'AT',
    'BE',
    'BUT',
    'BY',
    'FOR',
    'FROM',
    'I',
    'IF',
    'IN',
    'IS',
    'IT',
    'MY',
    'OF',
    'ON',
    'OR',
    'SO',
    'THE',
    'TO',
    'WE',
    'WITH',
  ])

  const candidates = (query.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [])
    .filter((token) => !stopWords.has(token))
  return Array.from(new Set(candidates))
}

function looksLikePortfolioDetailQuestion(text: string): boolean {
  const normalized = text.toLowerCase()
  if (!normalized.includes('?')) return false

  const asksForDetails =
    /\b(need|share|provide|confirm|clarify|what is|which|how many|do you|can you|could you|tell me)\b/.test(normalized)
  const portfolioNoun =
    /\b(portfolio|holding|holdings|position|positions|account|shares|allocation|cost basis|ticker|asset|lot|lots)\b/.test(normalized)

  return asksForDetails && portfolioNoun
}

function mentionsNetWorth(text: string): boolean {
  return /\bnet worth\b/.test(text.toLowerCase())
}

type HoldingSummary = {
  symbol: string
  currentPrice: number | null
  totalShares: number
  marketValue: number
  costBasis: number
  unrealizedGain: number
  themes: string[]
  accounts: Array<{
    location: string
    accountType: string
    shares: number
    marketValue: number
    costBasis: number
    lots: Array<{
      subtype: string
      purchaseDate: string
      shares: number
      costPrice: number
      capitalGainsStatus: string
    }>
    rsuGrants: Array<{
      grantDate: string
      totalShares: number
      vestStart: string
      vestEnd: string
      cliffDate: string | null
      endedAt: string | null
    }>
  }>
}

function buildFocusedPortfolioContext(query: string, assets: any[], tickers: any[], includeExtended = false) {
  const tickerBySymbol = new Map<string, any>()
  for (const ticker of tickers ?? []) {
    const symbol = normalizeSymbol((ticker as any)?.symbol)
    if (symbol) tickerBySymbol.set(symbol, ticker)
  }

  const holdingMap = new Map<string, HoldingSummary>()
  for (const asset of assets ?? []) {
    const isStock = String(asset?.asset_type ?? '') === 'Stock'
    if (!isStock) continue

    const symbol = normalizeSymbol(asset?.ticker?.symbol)
    if (!symbol) continue

    const currentPrice = asset?.ticker?.current_price == null ? null : Number(asset.ticker.current_price)
    const themes = Array.from(new Set(
      ((asset?.ticker?.ticker_themes ?? []) as any[])
        .map((entry) => String(entry?.theme?.name ?? '').trim())
        .filter(Boolean),
    ))

    const summary = holdingMap.get(symbol) ?? {
      symbol,
      currentPrice,
      totalShares: 0,
      marketValue: 0,
      costBasis: 0,
      unrealizedGain: 0,
      themes,
      accounts: [],
    }

    const accountLots: HoldingSummary['accounts'][number]['lots'] = []
    const accountGrants: HoldingSummary['accounts'][number]['rsuGrants'] = []
    let accountShares = 0
    let accountCostBasis = 0
    for (const subtype of asset?.stock_subtypes ?? []) {
      const subtypeName = String(subtype?.subtype ?? 'Market')
      for (const tx of subtype?.transactions ?? []) {
        const shares = Number(tx?.count ?? 0) || 0
        const costPrice = Number(tx?.cost_price ?? 0) || 0
        accountShares += shares
        accountCostBasis += shares * costPrice
        accountLots.push({
          subtype: subtypeName,
          purchaseDate: String(tx?.purchase_date ?? ''),
          shares,
          costPrice,
          capitalGainsStatus: String(tx?.capital_gains_status ?? ''),
        })
      }

      for (const grant of subtype?.rsu_grants ?? []) {
        accountGrants.push({
          grantDate: String(grant?.grant_date ?? ''),
          totalShares: Number(grant?.total_shares ?? 0) || 0,
          vestStart: String(grant?.vest_start ?? ''),
          vestEnd: String(grant?.vest_end ?? ''),
          cliffDate: grant?.cliff_date ? String(grant.cliff_date) : null,
          endedAt: grant?.ended_at ? String(grant.ended_at) : null,
        })
      }
    }

    const accountMarketValue = currentPrice == null ? 0 : accountShares * currentPrice
    summary.totalShares += accountShares
    summary.costBasis += accountCostBasis
    summary.marketValue += accountMarketValue
    summary.unrealizedGain = summary.marketValue - summary.costBasis
    summary.currentPrice = currentPrice
    summary.themes = Array.from(new Set([...(summary.themes ?? []), ...themes]))

    summary.accounts.push({
      location: String(asset?.location?.name ?? 'Unknown'),
      accountType: String(asset?.location?.account_type ?? ''),
      shares: accountShares,
      marketValue: accountMarketValue,
      costBasis: accountCostBasis,
      lots: accountLots
        .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
        .slice(0, includeExtended ? 30 : 12),
      rsuGrants: accountGrants
        .sort((a, b) => b.grantDate.localeCompare(a.grantDate))
        .slice(0, includeExtended ? 12 : 6),
    })

    holdingMap.set(symbol, summary)
  }

  const holdings = [...holdingMap.values()].sort((a, b) => b.marketValue - a.marketValue)
  const holdingBySymbol = new Map(holdings.map((h) => [h.symbol, h]))
  const allKnownSymbols = new Set<string>([
    ...[...tickerBySymbol.keys()],
    ...holdings.map((h) => h.symbol),
  ])

  const requestedSymbols = extractTickerCandidates(query)
  const mentionedKnownSymbols = requestedSymbols.filter((symbol) => allKnownSymbols.has(symbol))
  const focusSymbols = mentionedKnownSymbols.length > 0
    ? mentionedKnownSymbols
    : holdings.slice(0, includeExtended ? 8 : 4).map((h) => h.symbol)

  const focusHoldings = focusSymbols
    .map((symbol) => holdingBySymbol.get(symbol))
    .filter((item): item is HoldingSummary => !!item)

  const unownedRequestedSymbols = requestedSymbols
    .filter((symbol) => !holdingBySymbol.has(symbol))
    .map((symbol) => {
      const ticker = tickerBySymbol.get(symbol)
      return {
        symbol,
        currentPrice: ticker?.current_price == null ? null : Number(ticker.current_price),
        inWatchlist: ticker ? Boolean(ticker.watchlist_only) : false,
      }
    })

  const totalNetWorth = computeTotalNetWorth(assets as any)
  const totalStockValue = (assets ?? [])
    .filter((asset: any) => String(asset?.asset_type ?? '') === 'Stock')
    .reduce((sum: number, asset: any) => sum + computeAssetValue(asset), 0)
  const totalCashLikeValue = (assets ?? [])
    .filter((asset: any) => String(asset?.asset_type ?? '') !== 'Stock')
    .reduce((sum: number, asset: any) => sum + computeAssetValue(asset), 0)

  return {
    query,
    generatedAt: new Date().toISOString(),
    summary: {
      totalNetWorth: Math.round(totalNetWorth * 100) / 100,
      totalStockValue: Math.round(totalStockValue * 100) / 100,
      totalCashLikeValue: Math.round(totalCashLikeValue * 100) / 100,
      stockAllocationPct: totalNetWorth > 0 ? Math.round((totalStockValue / totalNetWorth) * 10000) / 100 : 0,
      positions: holdings.length,
      focusSymbols,
    },
    focusHoldings,
    unownedRequestedSymbols,
  }
}

type NetWorthRange = '1M' | '3M' | '6M' | '1Y' | 'ALL'
type ExposureDimension = 'ticker' | 'theme' | 'asset_type' | 'location'

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(value)
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function normalizeNetWorthRange(value: unknown): NetWorthRange {
  const normalized = String(value ?? '1Y').toUpperCase()
  if (normalized === '1M' || normalized === '3M' || normalized === '6M' || normalized === '1Y' || normalized === 'ALL') {
    return normalized
  }
  return '1Y'
}

function normalizeExposureDimension(value: unknown): ExposureDimension {
  const normalized = String(value ?? 'ticker').toLowerCase()
  if (normalized === 'ticker' || normalized === 'theme' || normalized === 'asset_type' || normalized === 'location') {
    return normalized
  }
  return 'ticker'
}

function differenceInDays(dateA: Date, dateB: Date): number {
  const ms = dateA.getTime() - dateB.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

type PositionRow = {
  assetName: string
  assetType: string
  symbol: string | null
  location: string
  accountType: string
  shares: number | null
  currentPrice: number | null
  marketValue: number
  costBasis: number | null
  unrealizedGain: number | null
  unrealizedGainPct: number | null
  themes: string[]
  subtypes: string[]
}

function buildPositionRows(assets: any[]): PositionRow[] {
  return (assets ?? []).map((asset: any) => {
    const assetType = String(asset?.asset_type ?? '')
    const symbol = assetType === 'Stock' ? normalizeSymbol(asset?.ticker?.symbol) || null : null
    const location = String(asset?.location?.name ?? 'Unknown')
    const accountType = String(asset?.location?.account_type ?? '')

    if (assetType !== 'Stock') {
      const marketValue = toNumber(asset?.price, 0)
      const initial = toNumber((asset as any)?.initial_price, marketValue)
      const unrealizedGain = marketValue - initial
      const unrealizedGainPct = initial > 0 ? (unrealizedGain / initial) * 100 : null
      return {
        assetName: String(asset?.name ?? ''),
        assetType,
        symbol: null,
        location,
        accountType,
        shares: null,
        currentPrice: null,
        marketValue: Math.round(marketValue * 100) / 100,
        costBasis: Math.round(initial * 100) / 100,
        unrealizedGain: Math.round(unrealizedGain * 100) / 100,
        unrealizedGainPct: unrealizedGainPct == null ? null : Math.round(unrealizedGainPct * 100) / 100,
        themes: [],
        subtypes: [],
      }
    }

    const shares = (asset?.stock_subtypes ?? [])
      .flatMap((st: any) => st?.transactions ?? [])
      .reduce((sum: number, tx: any) => sum + toNumber(tx?.count, 0), 0)
    const costBasis = computeCostBasis(asset)
    const marketValue = computeAssetValue(asset)
    const unrealizedGain = computeUnrealizedGain(asset)
    const unrealizedGainPct = costBasis > 0 ? (unrealizedGain / costBasis) * 100 : null
    const themes = Array.from(new Set(
      ((asset?.ticker?.ticker_themes ?? []) as any[])
        .map((entry) => String(entry?.theme?.name ?? '').trim())
        .filter(Boolean),
    ))
    const subtypes = Array.from(new Set(
      ((asset?.stock_subtypes ?? []) as any[]).map((st: any) => String(st?.subtype ?? '').trim()).filter(Boolean),
    ))

    return {
      assetName: String(asset?.name ?? ''),
      assetType,
      symbol,
      location,
      accountType,
      shares: Math.round(shares * 10000) / 10000,
      currentPrice: asset?.ticker?.current_price == null ? null : toNumber(asset.ticker.current_price, 0),
      marketValue: Math.round(marketValue * 100) / 100,
      costBasis: Math.round(costBasis * 100) / 100,
      unrealizedGain: Math.round(unrealizedGain * 100) / 100,
      unrealizedGainPct: unrealizedGainPct == null ? null : Math.round(unrealizedGainPct * 100) / 100,
      themes,
      subtypes,
    }
  }).sort((a, b) => b.marketValue - a.marketValue)
}

type TransactionRow = {
  symbol: string
  assetName: string
  location: string
  accountType: string
  subtype: string
  purchaseDate: string
  shares: number
  costPrice: number
  lotCostBasis: number
  capitalGainsStatus: string
}

function buildTransactionRows(assets: any[]): TransactionRow[] {
  const rows: TransactionRow[] = []
  for (const asset of assets ?? []) {
    if (String(asset?.asset_type ?? '') !== 'Stock') continue
    const symbol = normalizeSymbol(asset?.ticker?.symbol)
    if (!symbol) continue
    const assetName = String(asset?.name ?? '')
    const location = String(asset?.location?.name ?? 'Unknown')
    const accountType = String(asset?.location?.account_type ?? '')

    for (const subtype of asset?.stock_subtypes ?? []) {
      const subtypeName = String(subtype?.subtype ?? 'Market')
      for (const tx of subtype?.transactions ?? []) {
        const shares = toNumber(tx?.count, 0)
        const costPrice = toNumber(tx?.cost_price, 0)
        rows.push({
          symbol,
          assetName,
          location,
          accountType,
          subtype: subtypeName,
          purchaseDate: String(tx?.purchase_date ?? ''),
          shares: Math.round(shares * 10000) / 10000,
          costPrice: Math.round(costPrice * 100) / 100,
          lotCostBasis: Math.round(shares * costPrice * 100) / 100,
          capitalGainsStatus: String(tx?.capital_gains_status ?? ''),
        })
      }
    }
  }
  return rows.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
}

function filterSnapshotsByRange(points: any[], range: NetWorthRange) {
  if (points.length <= 1 || range === 'ALL') return points
  const latest = points[points.length - 1]
  if (!latest?.date) return points

  const endDate = new Date(`${latest.date}T00:00:00`)
  if (Number.isNaN(endDate.getTime())) return points

  const startDate = new Date(endDate)
  if (range === '1M') startDate.setMonth(startDate.getMonth() - 1)
  if (range === '3M') startDate.setMonth(startDate.getMonth() - 3)
  if (range === '6M') startDate.setMonth(startDate.getMonth() - 6)
  if (range === '1Y') startDate.setFullYear(startDate.getFullYear() - 1)

  const filtered = points.filter((point) => {
    if (!point?.date) return false
    const date = new Date(`${point.date}T00:00:00`)
    if (Number.isNaN(date.getTime())) return false
    return date >= startDate
  })

  if (filtered.length >= 2) return filtered
  return points.slice(Math.max(0, points.length - 2))
}

function buildExposureBreakdown(assets: any[], dimension: ExposureDimension, includeCash: boolean) {
  if (dimension === 'theme') {
    return computeThemeDistribution(assets, includeCash).map((row) => ({
      label: row.name,
      value: row.value,
    }))
  }

  const map: Record<string, number> = {}
  for (const asset of assets ?? []) {
    const isStock = String(asset?.asset_type ?? '') === 'Stock'
    if (!isStock && !includeCash && (dimension === 'ticker' || dimension === 'location')) continue
    const value = computeAssetValue(asset)
    if (value <= 0) continue

    let key = 'Unknown'
    if (dimension === 'ticker') {
      key = isStock ? (normalizeSymbol(asset?.ticker?.symbol) || 'Unknown Ticker') : 'Cash'
    } else if (dimension === 'asset_type') {
      key = String(asset?.asset_type ?? 'Unknown')
    } else if (dimension === 'location') {
      key = String(asset?.location?.name ?? 'Unknown')
    }
    map[key] = (map[key] ?? 0) + value
  }

  return Object.entries(map)
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
}

function buildTaxLotAnalysis(assets: any[], input: any) {
  const symbolsFilter = new Set(asStringArray(input?.symbols).map((symbol) => normalizeSymbol(symbol)))
  const harvestThresholdPct = toNumber(input?.harvest_threshold_pct, -5)
  const upcomingLongTermDays = toNumber(input?.upcoming_long_term_days, 45)
  const today = new Date()

  const lots = buildTransactionRows(assets)
    .filter((row) => symbolsFilter.size === 0 || symbolsFilter.has(row.symbol))
    .map((row) => {
      const asset = (assets ?? []).find((candidate: any) =>
        String(candidate?.asset_type ?? '') === 'Stock' &&
        normalizeSymbol(candidate?.ticker?.symbol) === row.symbol &&
        String(candidate?.name ?? '') === row.assetName &&
        String(candidate?.location?.name ?? 'Unknown') === row.location,
      )
      const currentPrice = asset?.ticker?.current_price == null ? null : toNumber(asset.ticker.current_price, 0)
      const gainPerShare = currentPrice == null ? null : currentPrice - row.costPrice
      const unrealizedGain = gainPerShare == null ? null : row.shares * gainPerShare
      const gainPct = gainPerShare == null || row.costPrice <= 0 ? null : (gainPerShare / row.costPrice) * 100

      const purchasedAt = new Date(`${row.purchaseDate}T00:00:00`)
      const daysHeld = Number.isNaN(purchasedAt.getTime()) ? null : differenceInDays(today, purchasedAt)
      const daysToLongTerm = daysHeld == null ? null : Math.max(0, 365 - daysHeld)

      return {
        ...row,
        currentPrice,
        unrealizedGain: unrealizedGain == null ? null : Math.round(unrealizedGain * 100) / 100,
        gainPct: gainPct == null ? null : Math.round(gainPct * 100) / 100,
        daysHeld,
        daysToLongTerm,
      }
    })

  let shortTermGain = 0
  let longTermGain = 0
  for (const lot of lots) {
    if (lot.unrealizedGain == null) continue
    const isLongTerm = String(lot.capitalGainsStatus).toLowerCase().includes('long')
    if (isLongTerm) longTermGain += lot.unrealizedGain
    else shortTermGain += lot.unrealizedGain
  }

  const harvestCandidates = lots
    .filter((lot) => lot.gainPct != null && lot.gainPct <= harvestThresholdPct)
    .sort((a, b) => (a.gainPct ?? 0) - (b.gainPct ?? 0))
    .slice(0, 10)

  const upcomingLongTerm = lots
    .filter((lot) => lot.daysToLongTerm != null && lot.daysToLongTerm <= upcomingLongTermDays && (lot.unrealizedGain ?? 0) > 0)
    .sort((a, b) => (a.daysToLongTerm ?? 9999) - (b.daysToLongTerm ?? 9999))
    .slice(0, 10)

  const topWinners = lots
    .filter((lot) => lot.unrealizedGain != null)
    .sort((a, b) => (b.unrealizedGain ?? 0) - (a.unrealizedGain ?? 0))
    .slice(0, 10)

  const topLosers = lots
    .filter((lot) => lot.unrealizedGain != null)
    .sort((a, b) => (a.unrealizedGain ?? 0) - (b.unrealizedGain ?? 0))
    .slice(0, 10)

  return {
    summary: {
      shortTermUnrealizedGain: Math.round(shortTermGain * 100) / 100,
      longTermUnrealizedGain: Math.round(longTermGain * 100) / 100,
      totalUnrealizedGain: Math.round((shortTermGain + longTermGain) * 100) / 100,
      lotsAnalyzed: lots.length,
      harvestCandidates: harvestCandidates.length,
      upcomingLongTermPromotions: upcomingLongTerm.length,
    },
    harvestCandidates,
    upcomingLongTerm,
    topWinners,
    topLosers,
  }
}

type SimPosition = {
  symbol: string
  shares: number
  costBasis: number
  currentPrice: number
}

function buildSimulationState(assets: any[]) {
  const stocks = new Map<string, SimPosition>()
  let cashLikeValue = 0

  for (const asset of assets ?? []) {
    const assetType = String(asset?.asset_type ?? '')
    if (assetType !== 'Stock') {
      cashLikeValue += toNumber(asset?.price, 0)
      continue
    }

    const symbol = normalizeSymbol(asset?.ticker?.symbol)
    if (!symbol) continue

    const existing = stocks.get(symbol) ?? {
      symbol,
      shares: 0,
      costBasis: 0,
      currentPrice: toNumber(asset?.ticker?.current_price, 0),
    }

    const lotShares = (asset?.stock_subtypes ?? [])
      .flatMap((st: any) => st?.transactions ?? [])
      .reduce((sum: number, tx: any) => sum + toNumber(tx?.count, 0), 0)
    const lotCostBasis = (asset?.stock_subtypes ?? [])
      .flatMap((st: any) => st?.transactions ?? [])
      .reduce((sum: number, tx: any) => sum + toNumber(tx?.count, 0) * toNumber(tx?.cost_price, 0), 0)

    existing.shares += lotShares
    existing.costBasis += lotCostBasis
    if (existing.currentPrice <= 0) {
      existing.currentPrice = toNumber(asset?.ticker?.current_price, existing.currentPrice)
    }

    stocks.set(symbol, existing)
  }

  return { stocks, cashLikeValue }
}

function summarizeSimulationState(state: { stocks: Map<string, SimPosition>; cashLikeValue: number }) {
  const holdings = [...state.stocks.values()]
    .filter((position) => position.shares > 0)
    .map((position) => {
      const marketValue = position.shares * position.currentPrice
      const unrealizedGain = marketValue - position.costBasis
      const unrealizedGainPct = position.costBasis > 0 ? (unrealizedGain / position.costBasis) * 100 : null
      return {
        symbol: position.symbol,
        shares: Math.round(position.shares * 10000) / 10000,
        currentPrice: Math.round(position.currentPrice * 100) / 100,
        marketValue: Math.round(marketValue * 100) / 100,
        costBasis: Math.round(position.costBasis * 100) / 100,
        unrealizedGain: Math.round(unrealizedGain * 100) / 100,
        unrealizedGainPct: unrealizedGainPct == null ? null : Math.round(unrealizedGainPct * 100) / 100,
      }
    })
    .sort((a, b) => b.marketValue - a.marketValue)

  const stockValue = holdings.reduce((sum, row) => sum + row.marketValue, 0)
  const cashValue = Math.round(state.cashLikeValue * 100) / 100
  const netWorth = Math.round((stockValue + cashValue) * 100) / 100
  const hhi = stockValue > 0
    ? holdings.reduce((sum, row) => {
        const weight = row.marketValue / stockValue
        return sum + weight * weight
      }, 0)
    : 0

  return {
    netWorth,
    stockValue: Math.round(stockValue * 100) / 100,
    cashLikeValue: cashValue,
    cashAllocationPct: netWorth > 0 ? Math.round((cashValue / netWorth) * 10000) / 100 : 0,
    positionCount: holdings.length,
    concentrationHHI: Math.round(hhi * 10000) / 10000,
    holdings: holdings.map((row) => ({
      ...row,
      allocationPct: stockValue > 0 ? Math.round((row.marketValue / stockValue) * 10000) / 100 : 0,
    })),
  }
}

function simulatePortfolioActions(assets: any[], input: any) {
  const actions = Array.isArray(input?.actions) ? input.actions : []
  const state = buildSimulationState(assets)
  const before = summarizeSimulationState(state)
  const warnings: string[] = []
  let realizedPnL = 0
  const appliedActions: any[] = []

  for (const rawAction of actions) {
    const type = String(rawAction?.type ?? '').toLowerCase().trim()

    if (type === 'buy_stock' || type === 'buy') {
      const symbol = normalizeSymbol(rawAction?.symbol)
      const shares = toNumber(rawAction?.shares ?? rawAction?.count, 0)
      if (!symbol || shares <= 0) {
        warnings.push('Skipped buy action with missing symbol or non-positive shares.')
        continue
      }
      const existing = state.stocks.get(symbol) ?? {
        symbol,
        shares: 0,
        costBasis: 0,
        currentPrice: 0,
      }
      const executionPrice = toNumber(rawAction?.price, existing.currentPrice || 0)
      if (executionPrice <= 0) {
        warnings.push(`Skipped buy for ${symbol} because no usable price was provided.`)
        continue
      }
      existing.currentPrice = existing.currentPrice > 0 ? existing.currentPrice : executionPrice
      existing.shares += shares
      existing.costBasis += shares * executionPrice
      state.stocks.set(symbol, existing)

      const useCash = rawAction?.use_cash !== false
      if (useCash) state.cashLikeValue -= shares * executionPrice
      appliedActions.push({ type: 'buy_stock', symbol, shares, price: executionPrice, useCash })
      continue
    }

    if (type === 'sell_stock' || type === 'sell') {
      const symbol = normalizeSymbol(rawAction?.symbol)
      const sharesRequested = toNumber(rawAction?.shares ?? rawAction?.count, 0)
      if (!symbol || sharesRequested <= 0) {
        warnings.push('Skipped sell action with missing symbol or non-positive shares.')
        continue
      }
      const existing = state.stocks.get(symbol)
      if (!existing || existing.shares <= 0) {
        warnings.push(`Skipped sell for ${symbol} because there is no simulated holding.`)
        continue
      }

      const shares = Math.min(sharesRequested, existing.shares)
      if (sharesRequested > existing.shares) {
        warnings.push(`Capped sell for ${symbol} from ${sharesRequested} to ${existing.shares.toFixed(4)} shares.`)
      }
      const executionPrice = toNumber(rawAction?.price, existing.currentPrice || 0)
      if (executionPrice <= 0) {
        warnings.push(`Skipped sell for ${symbol} because no usable sale price was provided.`)
        continue
      }

      const avgCost = existing.shares > 0 ? existing.costBasis / existing.shares : 0
      const costRemoved = avgCost * shares
      realizedPnL += shares * (executionPrice - avgCost)

      existing.shares -= shares
      existing.costBasis = Math.max(0, existing.costBasis - costRemoved)
      if (existing.shares <= 0.000001) {
        state.stocks.delete(symbol)
      } else {
        state.stocks.set(symbol, existing)
      }

      const moveProceedsToCash = rawAction?.move_proceeds_to_cash !== false
      if (moveProceedsToCash) state.cashLikeValue += shares * executionPrice
      appliedActions.push({ type: 'sell_stock', symbol, shares, price: executionPrice, moveProceedsToCash })
      continue
    }

    if (type === 'set_price') {
      const symbol = normalizeSymbol(rawAction?.symbol)
      const price = toNumber(rawAction?.price, 0)
      if (!symbol || price <= 0) {
        warnings.push('Skipped set_price action with missing symbol or non-positive price.')
        continue
      }
      const existing = state.stocks.get(symbol)
      if (!existing) {
        warnings.push(`Skipped set_price for ${symbol} because there is no simulated holding.`)
        continue
      }
      existing.currentPrice = price
      state.stocks.set(symbol, existing)
      appliedActions.push({ type: 'set_price', symbol, price })
      continue
    }

    if (type === 'add_cash' || type === 'deposit_cash') {
      const amount = toNumber(rawAction?.amount, 0)
      state.cashLikeValue += amount
      appliedActions.push({ type: 'add_cash', amount })
      continue
    }

    if (type === 'remove_cash' || type === 'withdraw_cash') {
      const amount = Math.abs(toNumber(rawAction?.amount, 0))
      state.cashLikeValue -= amount
      appliedActions.push({ type: 'remove_cash', amount })
      continue
    }

    if (type === 'set_cash_total') {
      const value = toNumber(rawAction?.value, state.cashLikeValue)
      state.cashLikeValue = value
      appliedActions.push({ type: 'set_cash_total', value })
      continue
    }

    warnings.push(`Unsupported action type "${type}" was ignored.`)
  }

  if (state.cashLikeValue < 0) {
    warnings.push(`Simulation resulted in negative cash (${formatUsd(state.cashLikeValue)}).`)
  }

  const after = summarizeSimulationState(state)
  return {
    before,
    after,
    delta: {
      netWorth: Math.round((after.netWorth - before.netWorth) * 100) / 100,
      stockValue: Math.round((after.stockValue - before.stockValue) * 100) / 100,
      cashLikeValue: Math.round((after.cashLikeValue - before.cashLikeValue) * 100) / 100,
      cashAllocationPct: Math.round((after.cashAllocationPct - before.cashAllocationPct) * 100) / 100,
      concentrationHHI: Math.round((after.concentrationHHI - before.concentrationHHI) * 10000) / 10000,
    },
    realizedPnL: Math.round(realizedPnL * 100) / 100,
    appliedActions,
    warnings,
    assumptions: [
      'Stock valuation uses current market price for each ticker.',
      'Sells use average cost basis unless explicit lot-level simulation is provided elsewhere.',
      'Non-stock assets are treated as cash-like value for simulation.',
    ],
  }
}

function recommendActionsForGoal(assets: any[], input: any) {
  const goal = String(input?.goal ?? '').toLowerCase().trim()
  const current = summarizeSimulationState(buildSimulationState(assets))
  const recommendations: Array<{ priority: 'high' | 'medium' | 'low'; action: string; rationale: string }> = []

  if (goal === 'reduce_concentration') {
    const targetMaxPct = Math.min(90, Math.max(5, toNumber(input?.target_max_single_ticker_pct, 25)))
    const largest = current.holdings[0]
    if (!largest) {
      recommendations.push({
        priority: 'low',
        action: 'No concentration adjustment needed.',
        rationale: 'No stock positions are currently held.',
      })
    } else if (largest.allocationPct <= targetMaxPct) {
      recommendations.push({
        priority: 'low',
        action: `Largest holding (${largest.symbol}) is already below ${targetMaxPct}% of stock exposure.`,
        rationale: 'Current concentration is within the requested cap.',
      })
    } else {
      const excessValue = largest.marketValue - (targetMaxPct / 100) * current.stockValue
      const suggestedShares = largest.currentPrice > 0 ? excessValue / largest.currentPrice : 0
      recommendations.push({
        priority: 'high',
        action: `Trim approximately ${suggestedShares.toFixed(2)} shares of ${largest.symbol}.`,
        rationale: `This moves ${largest.symbol} from ${largest.allocationPct.toFixed(1)}% toward the ${targetMaxPct}% concentration target.`,
      })
      recommendations.push({
        priority: 'medium',
        action: 'Reallocate trimmed value to underweight themes or hold as cash.',
        rationale: 'Concentration risk falls further when proceeds are spread across uncorrelated holdings.',
      })
    }
  } else if (goal === 'improve_diversification') {
    if (current.positionCount >= 6 && current.concentrationHHI <= 0.2) {
      recommendations.push({
        priority: 'low',
        action: 'Diversification already looks healthy.',
        rationale: 'You have multiple positions and concentration is moderate.',
      })
    } else {
      recommendations.push({
        priority: 'high',
        action: 'Add exposure to themes or sectors not currently represented.',
        rationale: `Current concentration HHI is ${current.concentrationHHI.toFixed(3)} with ${current.positionCount} stock positions.`,
      })
      const largest = current.holdings[0]
      if (largest) {
        recommendations.push({
          priority: 'medium',
          action: `Reduce ${largest.symbol} weight incrementally.`,
          rationale: `${largest.symbol} currently contributes ${largest.allocationPct.toFixed(1)}% of stock exposure.`,
        })
      }
    }
  } else if (goal === 'reduce_tax_burden') {
    const tax = buildTaxLotAnalysis(assets, input)
    if (tax.harvestCandidates.length > 0) {
      const candidate = tax.harvestCandidates[0]
      recommendations.push({
        priority: 'high',
        action: `Evaluate tax-loss harvesting on ${candidate.symbol} lot from ${candidate.purchaseDate}.`,
        rationale: `Lot is down ${candidate.gainPct?.toFixed(2)}% and may offset gains.`,
      })
    }
    if (tax.upcomingLongTerm.length > 0) {
      const upcoming = tax.upcomingLongTerm[0]
      recommendations.push({
        priority: 'medium',
        action: `Consider waiting ${upcoming.daysToLongTerm} more day(s) before selling ${upcoming.symbol} lot from ${upcoming.purchaseDate}.`,
        rationale: 'Potential promotion to long-term treatment may reduce taxes.',
      })
    }
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'low',
        action: 'No obvious tax optimization actions were detected.',
        rationale: 'No strong harvest candidates or near-term long-term promotions found.',
      })
    }
  } else if (goal === 'raise_cash_buffer') {
    const targetCashPct = Math.min(95, Math.max(0, toNumber(input?.target_cash_pct, 10)))
    const targetCashValue = (targetCashPct / 100) * current.netWorth
    const shortfall = Math.max(0, targetCashValue - current.cashLikeValue)
    if (shortfall <= 0) {
      recommendations.push({
        priority: 'low',
        action: `Cash buffer already meets ${targetCashPct.toFixed(1)}% target.`,
        rationale: `Current cash allocation is ${current.cashAllocationPct.toFixed(1)}%.`,
      })
    } else {
      recommendations.push({
        priority: 'high',
        action: `Raise approximately ${formatUsd(shortfall)} in cash.`,
        rationale: `Current cash allocation is ${current.cashAllocationPct.toFixed(1)}%, below target ${targetCashPct.toFixed(1)}%.`,
      })
      const largest = current.holdings[0]
      if (largest) {
        const shares = largest.currentPrice > 0 ? shortfall / largest.currentPrice : 0
        recommendations.push({
          priority: 'medium',
          action: `One approach: sell about ${shares.toFixed(2)} shares of ${largest.symbol}.`,
          rationale: 'Using the largest liquid position usually has minimal execution complexity.',
        })
      }
    }
  } else {
    recommendations.push({
      priority: 'low',
      action: 'Goal not recognized.',
      rationale: 'Use one of: reduce_concentration, improve_diversification, reduce_tax_burden, raise_cash_buffer.',
    })
  }

  return {
    goal,
    asOf: new Date().toISOString(),
    portfolioSummary: {
      netWorth: current.netWorth,
      stockValue: current.stockValue,
      cashLikeValue: current.cashLikeValue,
      cashAllocationPct: current.cashAllocationPct,
      positionCount: current.positionCount,
      concentrationHHI: current.concentrationHHI,
    },
    recommendations,
    disclaimer: 'Educational guidance only, not financial advice.',
  }
}

async function executeReadTool(
  toolName: string,
  input: any,
  context: {
    assets: any[]
    getSnapshotsCached: () => Promise<any[]>
  },
) {
  if (toolName === 'get_portfolio_summary') {
    const positions = buildPositionRows(context.assets)
    const stockPositions = positions.filter((row) => row.assetType === 'Stock')
    const cashLikePositions = positions.filter((row) => row.assetType !== 'Stock')
    const totalNetWorth = computeTotalNetWorth(context.assets)
    const totalStockValue = stockPositions.reduce((sum, row) => sum + row.marketValue, 0)
    const totalCashLikeValue = cashLikePositions.reduce((sum, row) => sum + row.marketValue, 0)
    const unrealizedStockPnL = stockPositions.reduce((sum, row) => sum + (row.unrealizedGain ?? 0), 0)
    return {
      asOf: new Date().toISOString(),
      totals: {
        netWorth: Math.round(totalNetWorth * 100) / 100,
        stockValue: Math.round(totalStockValue * 100) / 100,
        cashLikeValue: Math.round(totalCashLikeValue * 100) / 100,
        stockAllocationPct: totalNetWorth > 0 ? Math.round((totalStockValue / totalNetWorth) * 10000) / 100 : 0,
        unrealizedStockPnL: Math.round(unrealizedStockPnL * 100) / 100,
      },
      counts: {
        positions: positions.length,
        stockPositions: stockPositions.length,
        cashLikePositions: cashLikePositions.length,
      },
      topHoldings: stockPositions
        .sort((a, b) => b.marketValue - a.marketValue)
        .slice(0, 5)
        .map((row) => ({
          symbol: row.symbol,
          assetName: row.assetName,
          marketValue: row.marketValue,
          allocationPct: totalStockValue > 0 ? Math.round((row.marketValue / totalStockValue) * 10000) / 100 : 0,
        })),
    }
  }

  if (toolName === 'get_positions') {
    const symbolsFilter = new Set(asStringArray(input?.symbols).map((symbol) => normalizeSymbol(symbol)))
    const assetTypes = new Set(asStringArray(input?.asset_types).map((value) => value.toLowerCase()))
    const locationNames = new Set(asStringArray(input?.location_names).map((value) => value.toLowerCase()))
    const limit = Math.max(1, Math.min(500, toNumber(input?.limit, 200)))

    const rows = buildPositionRows(context.assets).filter((row) => {
      if (symbolsFilter.size > 0 && (!row.symbol || !symbolsFilter.has(row.symbol))) return false
      if (assetTypes.size > 0 && !assetTypes.has(row.assetType.toLowerCase())) return false
      if (locationNames.size > 0 && !locationNames.has(row.location.toLowerCase())) return false
      return true
    })

    return {
      count: rows.length,
      positions: rows.slice(0, limit),
    }
  }

  if (toolName === 'get_transactions') {
    const symbolsFilter = new Set(asStringArray(input?.symbols).map((symbol) => normalizeSymbol(symbol)))
    const subtypesFilter = new Set(asStringArray(input?.subtypes).map((subtype) => subtype.toLowerCase()))
    const fromDateRaw = String(input?.from_date ?? '').trim()
    const toDateRaw = String(input?.to_date ?? '').trim()
    const fromDate = fromDateRaw ? new Date(`${fromDateRaw}T00:00:00`) : null
    const toDate = toDateRaw ? new Date(`${toDateRaw}T00:00:00`) : null
    const limit = Math.max(1, Math.min(1000, toNumber(input?.limit, 250)))

    const rows = buildTransactionRows(context.assets).filter((row) => {
      if (symbolsFilter.size > 0 && !symbolsFilter.has(row.symbol)) return false
      if (subtypesFilter.size > 0 && !subtypesFilter.has(row.subtype.toLowerCase())) return false

      if (fromDate || toDate) {
        const date = new Date(`${row.purchaseDate}T00:00:00`)
        if (Number.isNaN(date.getTime())) return false
        if (fromDate && date < fromDate) return false
        if (toDate && date > toDate) return false
      }
      return true
    })

    return {
      count: rows.length,
      totals: {
        shares: Math.round(rows.reduce((sum, row) => sum + row.shares, 0) * 10000) / 10000,
        lotCostBasis: Math.round(rows.reduce((sum, row) => sum + row.lotCostBasis, 0) * 100) / 100,
      },
      transactions: rows.slice(0, limit),
    }
  }

  if (toolName === 'get_net_worth_timeseries') {
    const range = normalizeNetWorthRange(input?.range)
    const snapshots = await context.getSnapshotsCached()
    const fallbackDate = new Date().toISOString().slice(0, 10)
    const seed = snapshots.length > 0
      ? snapshots
      : [{ date: fallbackDate, value: Math.round(computeTotalNetWorth(context.assets) * 100) / 100 }]
    const filtered = filterSnapshotsByRange(seed, range)
    const first = filtered[0]
    const last = filtered[filtered.length - 1]
    const change = toNumber(last?.value, 0) - toNumber(first?.value, 0)
    const changePct = toNumber(first?.value, 0) > 0 ? (change / toNumber(first?.value, 0)) * 100 : 0

    return {
      range,
      points: filtered.map((point) => ({
        date: point.date,
        value: Math.round(toNumber(point.value, 0) * 100) / 100,
      })),
      summary: {
        startValue: Math.round(toNumber(first?.value, 0) * 100) / 100,
        endValue: Math.round(toNumber(last?.value, 0) * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePct: Math.round(changePct * 100) / 100,
      },
    }
  }

  if (toolName === 'get_exposure_breakdown') {
    const dimension = normalizeExposureDimension(input?.dimension)
    const includeCash = Boolean(input?.include_cash)
    const rows = buildExposureBreakdown(context.assets, dimension, includeCash)
    const total = rows.reduce((sum, row) => sum + row.value, 0)
    return {
      dimension,
      includeCash,
      totalValue: Math.round(total * 100) / 100,
      rows: rows.map((row) => ({
        ...row,
        allocationPct: total > 0 ? Math.round((row.value / total) * 10000) / 100 : 0,
      })),
    }
  }

  if (toolName === 'analyze_tax_lots') {
    return buildTaxLotAnalysis(context.assets, input)
  }

  if (toolName === 'simulate_portfolio_actions') {
    return simulatePortfolioActions(context.assets, input)
  }

  if (toolName === 'recommend_actions_for_goal') {
    return recommendActionsForGoal(context.assets, input)
  }

  throw new Error(`Unsupported read tool: ${toolName}`)
}

function summarizeReadToolResult(toolName: string, result: any): string {
  if (toolName === 'get_portfolio_summary') {
    const netWorth = toNumber(result?.totals?.netWorth, 0)
    const positions = toNumber(result?.counts?.positions, 0)
    return `net worth ${formatUsd(netWorth)}, ${positions} positions`
  }
  if (toolName === 'get_positions') {
    return `${toNumber(result?.count, 0)} position row(s)`
  }
  if (toolName === 'get_transactions') {
    return `${toNumber(result?.count, 0)} transaction lot(s)`
  }
  if (toolName === 'get_net_worth_timeseries') {
    const range = String(result?.range ?? '1Y')
    const points = Array.isArray(result?.points) ? result.points.length : 0
    const change = toNumber(result?.summary?.change, 0)
    return `${range} range, ${points} point(s), change ${formatUsd(change)}`
  }
  if (toolName === 'get_exposure_breakdown') {
    const dimension = String(result?.dimension ?? 'ticker')
    const rows = Array.isArray(result?.rows) ? result.rows.length : 0
    return `${dimension} dimension, ${rows} bucket(s)`
  }
  if (toolName === 'analyze_tax_lots') {
    const lots = toNumber(result?.summary?.lotsAnalyzed, 0)
    const harvest = toNumber(result?.summary?.harvestCandidates, 0)
    return `${lots} lot(s), ${harvest} harvest candidate(s)`
  }
  if (toolName === 'simulate_portfolio_actions') {
    const delta = toNumber(result?.delta?.netWorth, 0)
    const warnings = Array.isArray(result?.warnings) ? result.warnings.length : 0
    return `net worth delta ${formatUsd(delta)}, ${warnings} warning(s)`
  }
  if (toolName === 'recommend_actions_for_goal') {
    const goal = String(result?.goal ?? '')
    const recommendations = Array.isArray(result?.recommendations) ? result.recommendations.length : 0
    return `${goal || 'goal'} with ${recommendations} recommendation(s)`
  }
  return clipText(result, 160)
}

function extractTextFromClaudeResponse(response: any): string {
  return (response?.content ?? [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => String(block.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

export function buildSystemPrompt(assets: any[], userName?: string): string {
  return `You are a portfolio assistant for a personal finance app called mne.
The user will issue commands in natural language to read or write to their portfolio.
${userName ? `The user's name is ${userName}. Address them by name when appropriate.` : ''}
Current portfolio data (JSON):
${JSON.stringify(assets, null, 2)}

For read-only questions and analysis, respond directly in plain text.
For read-only questions involving exact numbers, trends, simulations, or recommendations, call read tools first and base your answer on tool outputs.
Never estimate portfolio totals, allocations, or tax-lot values without using a read tool.
Prefer short sections and bullet lists over markdown tables. Do not output pipe-table syntax.
For navigation/view requests use navigate_to. For data changes use the appropriate write tool.
Never infer location_name or account_type from existing portfolio data — always ask the user explicitly.
For sell_shares, require the source account/location name. For lot selection, require either:
- single-lot: purchase_date + count
- multi-lot: lots[] with purchase_date + count for each lot
If lot details are missing, ask a follow-up question.
When the user requests multiple new assets/tickers in one message, process them sequentially.
If required details are missing, ask follow-up questions for only the first unresolved asset and wait for the user's answer before moving to the next one.
When all required details are present for multiple assets, you may return multiple tool calls in order.
If the user mentions moving sale proceeds, put destination into sell_shares.proceeds_destination_asset_name and transfer amount (default to count×sale_price). Do NOT ask for a new total value.
If the user says they sold shares and does not mention proceeds transfer, ask whether they want to transfer the sale proceeds to another asset/account.
Today's date is ${new Date().toISOString().split('T')[0]}`
}

const tools: Anthropic.Tool[] = [
  {
    name: 'navigate_to',
    description: 'Navigate to a page in the app for read/view requests',
    input_schema: {
      type: 'object' as const,
      properties: {
        route: { type: 'string', enum: ['/', '/portfolio', '/charts', '/watchlist', '/settings'] },
      },
      required: ['route'],
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Return canonical portfolio totals and top holdings for exact read-only answers.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_positions',
    description: 'Return normalized positions with optional filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        asset_types: { type: 'array', items: { type: 'string' } },
        location_names: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max rows, default 200' },
      },
    },
  },
  {
    name: 'get_transactions',
    description: 'Return normalized stock transaction lots with optional symbol/date/subtype filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        subtypes: { type: 'array', items: { type: 'string' } },
        from_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        to_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        limit: { type: 'number', description: 'Max rows, default 250' },
      },
    },
  },
  {
    name: 'get_net_worth_timeseries',
    description: 'Return net worth history and changes for a selected range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        range: { type: 'string', enum: ['1M', '3M', '6M', '1Y', 'ALL'] },
      },
    },
  },
  {
    name: 'get_exposure_breakdown',
    description: 'Return exposure by ticker, theme, asset type, or location.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dimension: { type: 'string', enum: ['ticker', 'theme', 'asset_type', 'location'] },
        include_cash: { type: 'boolean', description: 'Include non-stock assets where applicable' },
      },
      required: ['dimension'],
    },
  },
  {
    name: 'analyze_tax_lots',
    description: 'Analyze tax lots for unrealized gains/losses, harvesting opportunities, and upcoming long-term promotions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbols: { type: 'array', items: { type: 'string' } },
        harvest_threshold_pct: { type: 'number', description: 'Default -5 (percent)' },
        upcoming_long_term_days: { type: 'number', description: 'Default 45 days' },
      },
    },
  },
  {
    name: 'simulate_portfolio_actions',
    description: 'Run a what-if simulation on portfolio actions and return before/after deltas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['buy_stock', 'sell_stock', 'set_price', 'add_cash', 'remove_cash', 'set_cash_total'],
              },
              symbol: { type: 'string' },
              shares: { type: 'number' },
              count: { type: 'number' },
              price: { type: 'number' },
              use_cash: { type: 'boolean' },
              move_proceeds_to_cash: { type: 'boolean' },
              amount: { type: 'number' },
              value: { type: 'number' },
            },
            required: ['type'],
          },
        },
      },
      required: ['actions'],
    },
  },
  {
    name: 'recommend_actions_for_goal',
    description: 'Generate portfolio-tailored recommendations for a specific goal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal: {
          type: 'string',
          enum: ['reduce_concentration', 'improve_diversification', 'reduce_tax_burden', 'raise_cash_buffer'],
        },
        target_max_single_ticker_pct: { type: 'number' },
        target_cash_pct: { type: 'number' },
        symbols: { type: 'array', items: { type: 'string' } },
        harvest_threshold_pct: { type: 'number' },
        upcoming_long_term_days: { type: 'number' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'add_stock_transaction',
    description: 'Add shares of a stock to the portfolio. Handles ticker, asset, subtype, and transaction creation automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        count: { type: 'number', description: 'Number of shares' },
        cost_price: { type: 'number', description: 'Price per share at purchase' },
        purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        subtype: { type: 'string', enum: ['Market', 'ESPP', 'RSU'], description: 'How shares were acquired, default Market' },
        asset_name: { type: 'string', description: 'Name for the position, defaults to "{SYMBOL} Stock"' },
        location_name: { type: 'string', description: 'Brokerage or account e.g. Fidelity, Schwab' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'], description: 'Default Individual' },
      },
      required: ['symbol', 'count', 'cost_price', 'purchase_date', 'location_name', 'account_type'],
    },
  },
  {
    name: 'add_cash_asset',
    description: 'Add a non-stock asset: 401k, CD, Cash, Deposit, or HSA',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the account' },
        asset_type: { type: 'string', enum: ['401k', 'CD', 'Cash', 'Deposit', 'HSA'] },
        location_name: { type: 'string', description: 'Institution name' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'] },
        price: { type: 'number', description: 'Current value in dollars' },
        notes: { type: 'string', description: 'Optional notes' },
      },
      required: ['name', 'asset_type', 'location_name', 'account_type', 'ownership', 'price'],
    },
  },
  {
    name: 'add_ticker_to_watchlist',
    description: 'Add a stock ticker to the watchlist for price tracking',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'add_ticker_themes',
    description: 'Assign one or more themes to a ticker. Reuse existing theme names when they already exist for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        themes: {
          type: 'array',
          description: 'Theme names to add to this ticker, e.g. ["AI","Cloud"]',
          items: { type: 'string' },
        },
      },
      required: ['symbol', 'themes'],
    },
  },
  {
    name: 'add_rsu_grant',
    description: 'Record an RSU grant award with its vesting schedule. Use this when the user receives a new RSU grant, not when shares vest.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        grant_date: { type: 'string', description: 'ISO date YYYY-MM-DD when the grant was awarded' },
        total_shares: { type: 'number', description: 'Total shares in the grant' },
        vest_start: { type: 'string', description: 'ISO date when vesting begins' },
        vest_end: { type: 'string', description: 'ISO date when vesting ends' },
        cliff_date: { type: 'string', description: 'Optional cliff date ISO YYYY-MM-DD' },
        asset_name: { type: 'string', description: 'Name for the position, defaults to "{SYMBOL} Stock"' },
        location_name: { type: 'string', description: 'Brokerage or account e.g. Fidelity, Schwab' },
        account_type: { type: 'string', enum: ['Investment', 'Checking', 'Savings', 'Misc'] },
        ownership: { type: 'string', enum: ['Individual', 'Joint'], description: 'Default Individual' },
      },
      required: ['symbol', 'grant_date', 'total_shares', 'vest_start', 'vest_end', 'location_name', 'account_type'],
    },
  },
  {
    name: 'sell_shares',
    description: 'Record a stock sale from one or more purchase-date lots in a specific account/location, with optional proceeds transfer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL' },
        count: { type: 'number', description: 'Number of shares sold (single-lot mode)' },
        sale_price: { type: 'number', description: 'Price per share at sale' },
        sale_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD for the original lot being sold (single-lot mode)' },
        lots: {
          type: 'array',
          description: 'Optional multi-lot mode: each entry specifies purchase_date and count sold from that lot.',
          items: {
            type: 'object',
            properties: {
              purchase_date: { type: 'string', description: 'ISO date YYYY-MM-DD for this lot' },
              count: { type: 'number', description: 'Shares sold from this lot' },
            },
            required: ['purchase_date', 'count'],
          },
        },
        source_location_name: { type: 'string', description: 'Account/location holding the shares, e.g. Fidelity or Robinhood' },
        proceeds_destination_asset_name: { type: 'string', description: 'Optional destination asset name to receive sale proceeds (e.g., Vanguard 401k)' },
        proceeds_transfer_amount: { type: 'number', description: 'Optional transfer amount; defaults to total shares sold × sale_price' },
      },
      required: ['symbol', 'sale_price', 'sale_date', 'source_location_name'],
    },
  },
  {
    name: 'update_asset_value',
    description: 'Update the current value of a non-stock asset (401k, CD, Cash, Deposit, HSA)',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_name: { type: 'string', description: 'Exact name of the asset as it appears in the portfolio' },
        price: { type: 'number', description: 'New current value in dollars' },
      },
      required: ['asset_name', 'price'],
    },
  },
]

const READ_TOOL_NAMES = new Set([
  'get_portfolio_summary',
  'get_positions',
  'get_transactions',
  'get_net_worth_timeseries',
  'get_exposure_breakdown',
  'analyze_tax_lots',
  'simulate_portfolio_actions',
  'recommend_actions_for_goal',
])

const WRITE_TOOL_NAMES = new Set([
  'add_stock_transaction',
  'add_cash_asset',
  'add_ticker_to_watchlist',
  'add_ticker_themes',
  'add_rsu_grant',
  'sell_shares',
  'update_asset_value',
])

function confirmationMessageFor(toolName: string, input: any): string {
  switch (toolName) {
    case 'add_stock_transaction': {
      const date = new Date(input.purchase_date)
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      const gainStatus = date < oneYearAgo ? 'Long Term' : 'Short Term'
      return `Add ${input.count} ${input.symbol.toUpperCase()} shares at $${input.cost_price}/share purchased on ${input.purchase_date} (${gainStatus}, ${input.subtype || 'Market'})`
    }
    case 'add_cash_asset':
      return `Add ${input.asset_type} account "${input.name}" at ${input.location_name} worth $${Number(input.price).toLocaleString()}`
    case 'add_ticker_to_watchlist':
      return `Add ${input.symbol.toUpperCase()} to watchlist`
    case 'add_ticker_themes': {
      const themes = Array.isArray(input.themes)
        ? input.themes.map((theme: unknown) => String(theme).trim()).filter(Boolean)
        : []
      return `Add ${themes.join(', ')} theme${themes.length === 1 ? '' : 's'} to ${input.symbol.toUpperCase()}`
    }
    case 'add_rsu_grant':
      return `Record ${input.total_shares}-share RSU grant of ${input.symbol.toUpperCase()} on ${input.grant_date} (vests ${input.vest_start} → ${input.vest_end})`
    case 'sell_shares': {
      const multiLots = Array.isArray(input.lots) ? input.lots : []
      const normalizedLots = multiLots.length > 0
        ? multiLots
        : [{ purchase_date: input.purchase_date, count: input.count }]
      const totalShares = normalizedLots.reduce((sum: number, lot: any) => sum + Number(lot.count ?? 0), 0)
      const lotSummary = normalizedLots
        .map((lot: any) => `${lot.count} on ${lot.purchase_date}`)
        .join(', ')
      const defaultTransfer = totalShares * Number(input.sale_price ?? 0)
      const rawTransferAmount = Number(input.proceeds_transfer_amount ?? defaultTransfer)
      const transferAmount = Number.isFinite(rawTransferAmount) ? rawTransferAmount : 0
      const transferText = input.proceeds_destination_asset_name
        ? `; transfer $${transferAmount.toLocaleString()} to ${input.proceeds_destination_asset_name}`
        : ''
      return `Sell ${totalShares} ${input.symbol.toUpperCase()} shares from ${input.source_location_name} at $${input.sale_price}/share on ${input.sale_date} (lots: ${lotSummary})${transferText}`
    }
    case 'update_asset_value':
      return `Update "${input.asset_name}" value to $${Number(input.price).toLocaleString()}`
    default:
      return `Execute ${toolName}`
  }
}

async function executeTool(toolName: string, input: any, userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  if (toolName === 'add_ticker_to_watchlist') {
    const symbol = String(input.symbol ?? '').trim().toUpperCase()
    if (!symbol) throw new Error('Ticker symbol is required')

    const { data: existingTicker } = await supabase.from('tickers')
      .select('id')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .maybeSingle()

    let tickerId = existingTicker?.id as string | undefined
    let isNewTicker = false

    if (!tickerId) {
      const { data: createdTicker, error: createTickerError } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol, watchlist_only: true })
        .select('id')
        .single()
      if (createTickerError) throw new Error(`Failed to add ticker: ${createTickerError.message}`)
      tickerId = createdTicker.id
      isNewTicker = true
    }

    if (isNewTicker && tickerId) {
      try {
        await autoAssignThemesForTickerIfEnabled({ userId, tickerId, symbol, skipIfAlreadyTagged: true })
      } catch (error) {
        console.warn('Auto theme assignment failed for watchlist ticker', error)
      }
    }
    return
  }

  if (toolName === 'add_ticker_themes') {
    const symbol = String(input.symbol ?? '').trim().toUpperCase()
    if (!symbol) throw new Error('Ticker symbol is required')

    const themeNames: string[] = Array.isArray(input.themes)
      ? Array.from(new Set(
          input.themes
            .map((theme: unknown) => String(theme).trim())
            .filter((theme: string) => theme.length > 0),
        ))
      : []

    if (themeNames.length === 0) {
      throw new Error('At least one theme name is required')
    }

    const { data: existingTicker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()

    let tickerId = existingTicker?.id as string | undefined
    if (!tickerId) {
      const { data: createdTicker, error: tickerError } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol, watchlist_only: true })
        .select('id')
        .single()
      if (tickerError) throw new Error(`Failed to create ticker: ${tickerError.message}`)
      tickerId = createdTicker.id
    }

    const { data: existingThemes, error: existingThemesError } = await supabase.from('themes')
      .select('id, name')
      .eq('user_id', userId)
    if (existingThemesError) throw new Error(`Failed to load existing themes: ${existingThemesError.message}`)

    const themeIdByName = new Map<string, string>()
    for (const theme of existingThemes ?? []) {
      const key = String(theme.name ?? '').trim().toLowerCase()
      if (key) themeIdByName.set(key, theme.id)
    }

    for (const name of themeNames) {
      const key = name.toLowerCase()
      let themeId: string | undefined = themeIdByName.get(key)

      if (!themeId) {
        const { data: insertedTheme, error: insertThemeError } = await supabase.from('themes')
          .insert({ user_id: userId, name })
          .select('id')
          .single()
        if (insertThemeError) throw new Error(`Failed to create theme "${name}": ${insertThemeError.message}`)
        themeId = insertedTheme.id
        if (themeId) themeIdByName.set(key, themeId)
      }

      if (!themeId) throw new Error(`Failed to resolve theme id for "${name}"`)

      const { error: linkError } = await supabase.from('ticker_themes')
        .upsert({ ticker_id: tickerId, theme_id: themeId })
      if (linkError) throw new Error(`Failed to assign theme "${name}": ${linkError.message}`)
    }

    return
  }

  if (toolName === 'add_cash_asset') {
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { error } = await supabase.from('assets').insert({
      user_id: userId,
      name: input.name,
      asset_type: input.asset_type,
      location_id: locationId,
      ownership: input.ownership,
      price: input.price,
      initial_price: input.price,
      notes: input.notes ?? null,
    })
    if (error) throw new Error(`Failed to add asset: ${error.message}`)
    return
  }

  if (toolName === 'add_stock_transaction') {
    const symbol = input.symbol.toUpperCase()
    const subtype = input.subtype || 'Market'

    // 1. Find or create ticker
    const { data: existingTicker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    let tickerId: string
    if (existingTicker) {
      tickerId = existingTicker.id
    } else {
      const { data, error } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol }).select('id').single()
      if (error) throw new Error(`Failed to create ticker: ${error.message}`)
      tickerId = data.id
    }

    // Fetch live price if ticker is new (best effort, don't block on failure)
    if (!existingTicker) {
      await fetchAndStorePrice(tickerId, symbol)
      try {
        await autoAssignThemesForTickerIfEnabled({ userId, tickerId, symbol, skipIfAlreadyTagged: true })
      } catch (error) {
        console.warn('Auto theme assignment failed for new stock ticker', error)
      }
    }
    await supabase.from('tickers').update({ watchlist_only: false }).eq('id', tickerId)

    // 2. Find or create asset linked to this ticker at the given location
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { data: existingAsset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', tickerId).eq('location_id', locationId).maybeSingle()
    let assetId: string
    if (existingAsset) {
      assetId = existingAsset.id
    } else {
      const { data, error } = await supabase.from('assets').insert({
        user_id: userId,
        name: input.asset_name || `${symbol} Stock`,
        asset_type: 'Stock',
        location_id: locationId,
        ownership: input.ownership || 'Individual',
        ticker_id: tickerId,
      }).select('id').single()
      if (error) throw new Error(`Failed to create asset: ${error.message}`)
      assetId = data.id
    }

    // 3. Find or create stock_subtype (Market/ESPP/RSU bucket)
    const { data: existingSubtype } = await supabase.from('stock_subtypes')
      .select('id').eq('asset_id', assetId).eq('subtype', subtype).maybeSingle()
    let subtypeId: string
    if (existingSubtype) {
      subtypeId = existingSubtype.id
    } else {
      const { data, error } = await supabase.from('stock_subtypes')
        .insert({ asset_id: assetId, subtype }).select('id').single()
      if (error) throw new Error(`Failed to create stock subtype: ${error.message}`)
      subtypeId = data.id
    }

    // 4. Determine capital gains status from purchase date
    const purchaseDate = new Date(input.purchase_date)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const capital_gains_status = purchaseDate < oneYearAgo ? 'Long Term' : 'Short Term'

    // 5. Create the transaction (tax lot)
    const { error } = await supabase.from('transactions').insert({
      subtype_id: subtypeId,
      count: input.count,
      cost_price: input.cost_price,
      purchase_date: input.purchase_date,
      capital_gains_status,
    })
    if (error) throw new Error(`Failed to create transaction: ${error.message}`)
  }

  if (toolName === 'add_rsu_grant') {
    const symbol = input.symbol.toUpperCase()

    // 1. Find or create ticker
    const { data: existingTicker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    let tickerId: string
    if (existingTicker) {
      tickerId = existingTicker.id
    } else {
      const { data, error } = await supabase.from('tickers')
        .insert({ user_id: userId, symbol }).select('id').single()
      if (error) throw new Error(`Failed to create ticker: ${error.message}`)
      tickerId = data.id
      await fetchAndStorePrice(tickerId, symbol)
      try {
        await autoAssignThemesForTickerIfEnabled({ userId, tickerId, symbol, skipIfAlreadyTagged: true })
      } catch (error) {
        console.warn('Auto theme assignment failed for new RSU ticker', error)
      }
    }
    await supabase.from('tickers').update({ watchlist_only: false }).eq('id', tickerId)

    // 2. Find or create asset linked to this ticker at the given location
    const locationId = await findOrCreateLocation(userId, input.location_name, input.account_type)
    const { data: existingAsset } = await supabase.from('assets')
      .select('id').eq('user_id', userId).eq('ticker_id', tickerId).eq('location_id', locationId).maybeSingle()
    let assetId: string
    if (existingAsset) {
      assetId = existingAsset.id
    } else {
      const { data, error } = await supabase.from('assets').insert({
        user_id: userId,
        name: input.asset_name || `${symbol} Stock`,
        asset_type: 'Stock',
        location_id: locationId,
        ownership: input.ownership || 'Individual',
        ticker_id: tickerId,
      }).select('id').single()
      if (error) throw new Error(`Failed to create asset: ${error.message}`)
      assetId = data.id
    }

    // 3. Find or create RSU stock_subtype
    const { data: existingSubtype } = await supabase.from('stock_subtypes')
      .select('id').eq('asset_id', assetId).eq('subtype', 'RSU').maybeSingle()
    let subtypeId: string
    if (existingSubtype) {
      subtypeId = existingSubtype.id
    } else {
      const { data, error } = await supabase.from('stock_subtypes')
        .insert({ asset_id: assetId, subtype: 'RSU' }).select('id').single()
      if (error) throw new Error(`Failed to create RSU subtype: ${error.message}`)
      subtypeId = data.id
    }

    // 4. Insert the grant record
    const { error } = await supabase.from('rsu_grants').insert({
      subtype_id: subtypeId,
      grant_date: input.grant_date,
      total_shares: input.total_shares,
      vest_start: input.vest_start,
      vest_end: input.vest_end,
      cliff_date: input.cliff_date ?? null,
    })
    if (error) throw new Error(`Failed to create RSU grant: ${error.message}`)
  }

  if (toolName === 'sell_shares') {
    const symbol = input.symbol.toUpperCase()

    const { data: ticker } = await supabase.from('tickers')
      .select('id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
    if (!ticker) throw new Error(`No position found for ${symbol}`)

    const sourceAccount = String(input.source_location_name ?? '').trim()
    if (!sourceAccount) throw new Error('source_location_name is required')

    const requestedLots = Array.isArray(input.lots) ? input.lots : []
    const saleLots: Array<{ purchase_date: string; count: number }> = requestedLots.length > 0
      ? requestedLots.map((lot: any) => ({
          purchase_date: String(lot.purchase_date ?? '').trim(),
          count: Number(lot.count),
        }))
      : [{
          purchase_date: String(input.purchase_date ?? '').trim(),
          count: Number(input.count),
        }]
    if (saleLots.some((lot) => !lot.purchase_date || !Number.isFinite(lot.count) || lot.count <= 0)) {
      throw new Error('For sell_shares, provide valid lot details: purchase_date and positive count for each lot')
    }

    const { data: stockAssets, error: assetsErr } = await supabase.from('assets')
      .select('id, name, location:locations(name)')
      .eq('user_id', userId)
      .eq('ticker_id', ticker.id)
      .eq('asset_type', 'Stock')
    if (assetsErr) throw new Error(`Failed to fetch stock assets: ${assetsErr.message}`)
    if (!stockAssets || stockAssets.length === 0) throw new Error(`No stock asset found for ${symbol}`)

    const accountQuery = sourceAccount.toLowerCase()
    const matchedAssets = stockAssets.filter((asset: any) => {
      const assetName = String(asset.name ?? '').toLowerCase()
      const locationName = String(asset.location?.name ?? '').toLowerCase()
      return assetName.includes(accountQuery) || locationName.includes(accountQuery)
    })
    if (matchedAssets.length === 0) {
      throw new Error(`No ${symbol} stock position found in account "${sourceAccount}"`)
    }

    const matchedLocationNames = Array.from(
      new Set(matchedAssets.map((asset: any) => String(asset.location?.name ?? '').trim()).filter(Boolean)),
    )
    if (matchedLocationNames.length > 1) {
      throw new Error(
        `Account name "${sourceAccount}" is ambiguous. Matches: ${matchedLocationNames.join(', ')}. Please be more specific.`,
      )
    }

    const matchedAssetIds = matchedAssets.map((asset: any) => asset.id)

    const { data: subtypes } = await supabase.from('stock_subtypes')
      .select('id')
      .in('asset_id', matchedAssetIds)
    if (!subtypes || subtypes.length === 0) throw new Error(`No lots found for ${symbol}`)

    const subtypeIds = subtypes.map(s => s.id)
    let totalSharesSold = 0
    for (const lotSpec of saleLots) {
      const { data: lots } = await supabase.from('transactions')
        .select('id, count')
        .in('subtype_id', subtypeIds)
        .eq('purchase_date', lotSpec.purchase_date)
        .order('id', { ascending: true })
      if (!lots || lots.length === 0) {
        throw new Error(`No ${symbol} lots found in "${sourceAccount}" for purchase date ${lotSpec.purchase_date}`)
      }

      const availableShares = lots.reduce((sum: number, lot: any) => sum + Number(lot.count ?? 0), 0)
      if (availableShares < lotSpec.count) {
        throw new Error(
          `Not enough shares in selected lot: ${availableShares} available on ${lotSpec.purchase_date} in "${sourceAccount}", tried to sell ${lotSpec.count}`,
        )
      }

      let remaining = lotSpec.count
      for (const lot of lots) {
        if (remaining <= 0) break
        const lotCount = Number(lot.count)
        if (lotCount <= remaining) {
          await supabase.from('transactions').delete().eq('id', lot.id)
          remaining -= lotCount
        } else {
          await supabase.from('transactions').update({ count: lotCount - remaining }).eq('id', lot.id)
          remaining = 0
        }
      }
      totalSharesSold += lotSpec.count
    }

    const { data: subtypeState, error: subtypeStateError } = await supabase.from('stock_subtypes')
      .select('asset_id, transactions(count), rsu_grants(id, ended_at)')
      .in('asset_id', matchedAssetIds)
    if (subtypeStateError) throw new Error(`Failed to fetch remaining subtype state: ${subtypeStateError.message}`)

    const assetState = new Map<string, { shares: number; hasActiveGrant: boolean }>()
    for (const subtype of subtypeState ?? []) {
      const assetId = String((subtype as any).asset_id)
      const current = assetState.get(assetId) ?? { shares: 0, hasActiveGrant: false }
      const txShares = ((subtype as any).transactions ?? []).reduce(
        (sum: number, tx: any) => sum + Number(tx.count ?? 0),
        0,
      )
      const hasActiveGrant = ((subtype as any).rsu_grants ?? []).some((grant: any) => !grant.ended_at)
      assetState.set(assetId, {
        shares: current.shares + txShares,
        hasActiveGrant: current.hasActiveGrant || hasActiveGrant,
      })
    }

    const assetsToDelete = matchedAssetIds.filter((assetId) => {
      const state = assetState.get(assetId)
      const shares = state?.shares ?? 0
      const hasActiveGrant = state?.hasActiveGrant ?? false
      return shares <= 0 && !hasActiveGrant
    })
    if (assetsToDelete.length > 0) {
      const { error: deleteAssetsError } = await supabase.from('assets').delete().in('id', assetsToDelete)
      if (deleteAssetsError) throw new Error(`Failed to remove fully sold asset: ${deleteAssetsError.message}`)
    }

    const { count: remainingStockAssetCount, error: remainingCountError } = await supabase.from('assets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ticker_id', ticker.id)
      .eq('asset_type', 'Stock')
    if (remainingCountError) throw new Error(`Failed to refresh ticker ownership: ${remainingCountError.message}`)

    const shouldBeWatchlistOnly = (remainingStockAssetCount ?? 0) === 0
    const { error: tickerUpdateError } = await supabase.from('tickers')
      .update({ watchlist_only: shouldBeWatchlistOnly })
      .eq('id', ticker.id)
    if (tickerUpdateError) throw new Error(`Failed to refresh ticker state: ${tickerUpdateError.message}`)

    const destinationAssetName = String(input.proceeds_destination_asset_name ?? '').trim()
    if (destinationAssetName) {
      const salePrice = Number(input.sale_price)
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        throw new Error('sale_price must be a valid non-negative number')
      }

      const defaultTransfer = Math.round(totalSharesSold * salePrice * 100) / 100
      const transferAmount = Number(input.proceeds_transfer_amount ?? defaultTransfer)
      if (!Number.isFinite(transferAmount) || transferAmount < 0) {
        throw new Error('proceeds_transfer_amount must be a valid non-negative number')
      }

      const { data: destinationAssets, error: destinationLookupError } = await supabase.from('assets')
        .select('id, name, asset_type, price, location:locations(name)')
        .eq('user_id', userId)
        .eq('name', destinationAssetName)
      if (destinationLookupError) {
        throw new Error(`Failed to find proceeds destination: ${destinationLookupError.message}`)
      }
      if (!destinationAssets || destinationAssets.length === 0) {
        throw new Error(`No destination asset found named "${destinationAssetName}"`)
      }
      if (destinationAssets.length > 1) {
        const options = destinationAssets.map((a: any) => `${a.name} (${a.location?.name ?? 'Unknown'})`).join(', ')
        throw new Error(`Destination asset name "${destinationAssetName}" is ambiguous. Matches: ${options}`)
      }

      const destinationAsset = destinationAssets[0] as any
      if (destinationAsset.asset_type === 'Stock') {
        throw new Error('Destination for proceeds transfer must be a non-stock asset (e.g. 401k, Cash, HSA)')
      }

      const currentValue = Number(destinationAsset.price ?? 0)
      const nextValue = Math.round((currentValue + transferAmount) * 100) / 100
      const { error: destinationUpdateError } = await supabase.from('assets')
        .update({ price: nextValue })
        .eq('id', destinationAsset.id)
      if (destinationUpdateError) {
        throw new Error(`Failed to transfer proceeds: ${destinationUpdateError.message}`)
      }
    }
  }

  if (toolName === 'update_asset_value') {
    const { data, error } = await supabase.from('assets')
      .update({ price: input.price })
      .eq('user_id', userId)
      .eq('name', input.asset_name)
      .select('id')
    if (error) throw new Error(`Failed to update asset: ${error.message}`)
    if (!data || data.length === 0) throw new Error(`No asset found with name "${input.asset_name}"`)
  }
}

// ─── Direct dev commands (bypass Claude API) ──────────────────────────────────

async function createMockDataCommand(): Promise<any> {
  return {
    type: 'write_confirm',
    confirmationMessage: 'Create mock portfolio? Adds AAPL/MSFT/NVDA stocks with Market/ESPP/RSU subtypes, an unvested RSU grant, watchlist-only TSLA, and cash accounts.',
    execute: async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeMockData(user.id)
    },
  }
}

async function deleteAllDataCommand(): Promise<any> {
  return {
    type: 'write_confirm',
    confirmationMessage: 'Delete ALL portfolio data including assets, stock positions, RSU grants, tickers, and locations? This cannot be undone.',
    execute: async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeDeleteAllData(user.id)
    },
  }
}

async function createMockNotificationCommand(type: string): Promise<any> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: subs } = await supabase
    .from('push_subscriptions').select('id').eq('user_id', user.id).limit(1)
  if (!subs || subs.length === 0) {
    return {
      type: 'text',
      message: 'Push notifications are not enabled. Go to Settings → Notifications to enable them first.',
    }
  }

  const labels: Record<string, string> = {
    capital_gains: 'Create a mock Short Term lot (now Long Term), triggering a Capital Gains notification',
    price_movement: 'Create a mock DEMO ticker above your price alert threshold, triggering a Price Movement notification',
    rsu_grant: 'Create a mock RSU grant vesting within your alert window, triggering an RSU Vesting notification',
  }
  return {
    type: 'write_confirm',
    confirmationMessage: labels[type] ?? `Trigger ${type} notification`,
    execute: async () => { await executeMockNotification(type, user.id) },
  }
}

async function executeMockData(userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const fidelityId = await findOrCreateLocation(userId, 'Fidelity', 'Investment')
  const chaseId    = await findOrCreateLocation(userId, 'Chase', 'Checking')
  const vanguardId = await findOrCreateLocation(userId, 'Vanguard', 'Investment')

  async function upsertTicker(symbol: string, watchlistOnly = false): Promise<string> {
    const { data, error } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol, watchlist_only: watchlistOnly }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (error) throw new Error(`Failed to upsert ticker ${symbol}: ${error.message}`)
    return data.id
  }

  const aaplTickerId = await upsertTicker('AAPL')
  const msftTickerId = await upsertTicker('MSFT')
  const nvdaTickerId = await upsertTicker('NVDA')
  await upsertTicker('TSLA', true)

  async function insertAsset(name: string, assetType: string, locationId: string, tickerId?: string, price?: number): Promise<string> {
    const { data, error } = await supabase.from('assets').insert({
      user_id: userId, name, asset_type: assetType,
      location_id: locationId, ownership: 'Individual',
      ticker_id: tickerId ?? null, price: price ?? null,
    }).select('id').single()
    if (error) throw new Error(`Failed to create asset "${name}": ${error.message}`)
    return data.id
  }

  const aaplAssetId = await insertAsset('Apple Stock', 'Stock', fidelityId, aaplTickerId)
  const msftAssetId = await insertAsset('Microsoft Stock', 'Stock', fidelityId, msftTickerId)
  const nvdaAssetId = await insertAsset('NVIDIA Stock', 'Stock', vanguardId, nvdaTickerId)
  await insertAsset('Emergency Fund', 'Cash', chaseId, undefined, 25_000)
  await insertAsset('Vanguard 401k', '401k', vanguardId, undefined, 85_000)

  async function insertSubtype(assetId: string, subtype: string): Promise<string> {
    const { data, error } = await supabase.from('stock_subtypes')
      .insert({ asset_id: assetId, subtype }).select('id').single()
    if (error) throw new Error(`Failed to create subtype: ${error.message}`)
    return data.id
  }

  // AAPL: Market (Long Term + Short Term) + ESPP (Short Term)
  const aaplMarketId = await insertSubtype(aaplAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: aaplMarketId, count: 50, cost_price: 145, purchase_date: '2022-03-15', capital_gains_status: 'Long Term' },
    { subtype_id: aaplMarketId, count: 25, cost_price: 195, purchase_date: '2025-08-01', capital_gains_status: 'Short Term' },
  ])
  const aaplEsppId = await insertSubtype(aaplAssetId, 'ESPP')
  await supabase.from('transactions').insert([
    { subtype_id: aaplEsppId, count: 15, cost_price: 170, purchase_date: '2025-04-10', capital_gains_status: 'Short Term' },
  ])

  // MSFT: Market (Long Term) + RSU (vested Long Term + unvested grant)
  const msftMarketId = await insertSubtype(msftAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: msftMarketId, count: 30, cost_price: 285, purchase_date: '2023-09-10', capital_gains_status: 'Long Term' },
  ])
  const msftRsuId = await insertSubtype(msftAssetId, 'RSU')
  await supabase.from('transactions').insert([
    { subtype_id: msftRsuId, count: 50, cost_price: 310, purchase_date: '2024-01-15', capital_gains_status: 'Long Term' },
  ])
  await supabase.from('rsu_grants').insert({
    subtype_id: msftRsuId,
    grant_date: '2023-07-01',
    total_shares: 200,
    vest_start: '2024-07-01',
    vest_end: '2027-07-01',
    cliff_date: '2024-07-01',
  })

  // NVDA: Market (Short Term)
  const nvdaMarketId = await insertSubtype(nvdaAssetId, 'Market')
  await supabase.from('transactions').insert([
    { subtype_id: nvdaMarketId, count: 20, cost_price: 880, purchase_date: '2025-11-20', capital_gains_status: 'Short Term' },
  ])
}

async function executeDeleteAllData(userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const { data: assets, error: assetsError } = await supabase.from('assets').select('id').eq('user_id', userId)
  if (assetsError) throw new Error(`Failed to load assets: ${assetsError.message}`)
  const assetIds = (assets ?? []).map(a => a.id)

  if (assetIds.length > 0) {
    const { data: subtypes, error: subtypesError } = await supabase.from('stock_subtypes').select('id').in('asset_id', assetIds)
    if (subtypesError) throw new Error(`Failed to load stock subtypes: ${subtypesError.message}`)
    const subtypeIds = (subtypes ?? []).map(s => s.id)
    if (subtypeIds.length > 0) {
      const { error: transactionsDeleteError } = await supabase.from('transactions').delete().in('subtype_id', subtypeIds)
      if (transactionsDeleteError) throw new Error(`Failed to delete transactions: ${transactionsDeleteError.message}`)

      const { error: grantsDeleteError } = await supabase.from('rsu_grants').delete().in('subtype_id', subtypeIds)
      if (grantsDeleteError) throw new Error(`Failed to delete RSU grants: ${grantsDeleteError.message}`)

      const { error: subtypesDeleteError } = await supabase.from('stock_subtypes').delete().in('id', subtypeIds)
      if (subtypesDeleteError) throw new Error(`Failed to delete stock subtypes: ${subtypesDeleteError.message}`)
    }
    const { error: assetsDeleteError } = await supabase.from('assets').delete().in('id', assetIds)
    if (assetsDeleteError) throw new Error(`Failed to delete assets: ${assetsDeleteError.message}`)
  }

  const { data: tickers, error: tickersError } = await supabase.from('tickers').select('id').eq('user_id', userId)
  if (tickersError) throw new Error(`Failed to load tickers: ${tickersError.message}`)
  const tickerIds = (tickers ?? []).map((t: any) => t.id)

  if (tickerIds.length > 0) {
    const { error: tickerThemesDeleteError } = await supabase.from('ticker_themes').delete().in('ticker_id', tickerIds)
    if (tickerThemesDeleteError) throw new Error(`Failed to delete ticker theme links: ${tickerThemesDeleteError.message}`)
  }

  const { error: tickersDeleteError } = await supabase.from('tickers').delete().eq('user_id', userId)
  if (tickersDeleteError) throw new Error(`Failed to delete tickers: ${tickersDeleteError.message}`)

  const { error: themeTargetsDeleteError } = await supabase.from('theme_targets').delete().eq('user_id', userId)
  if (themeTargetsDeleteError) throw new Error(`Failed to delete theme targets: ${themeTargetsDeleteError.message}`)

  const { error: themesDeleteError } = await supabase.from('themes').delete().eq('user_id', userId)
  if (themesDeleteError) throw new Error(`Failed to delete themes: ${themesDeleteError.message}`)

  const { error: snapshotsDeleteError } = await supabase.from('net_worth_snapshots').delete().eq('user_id', userId)
  if (snapshotsDeleteError) throw new Error(`Failed to delete net worth snapshots: ${snapshotsDeleteError.message}`)

  const { error: locationsDeleteError } = await supabase.from('locations').delete().eq('user_id', userId)
  if (locationsDeleteError) throw new Error(`Failed to delete locations: ${locationsDeleteError.message}`)
}

async function executeMockNotification(type: string, userId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  if (type === 'capital_gains') {
    // Purchase date just past the 1-year Long Term threshold
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - 1)
    cutoff.setDate(cutoff.getDate() - 1)
    const purchaseDate = cutoff.toISOString().split('T')[0]

    const locationId = await findOrCreateLocation(userId, 'Demo Broker', 'Investment')
    const { data: ticker, error: tErr } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol: 'DEMO', watchlist_only: false }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (tErr) throw new Error(`Failed to upsert ticker: ${tErr.message}`)

    const { data: asset, error: aErr } = await supabase.from('assets').insert({
      user_id: userId, name: 'Demo Stock', asset_type: 'Stock',
      location_id: locationId, ownership: 'Individual', ticker_id: ticker.id,
    }).select('id').single()
    if (aErr) throw new Error(`Failed to create asset: ${aErr.message}`)

    const { data: subtype, error: sErr } = await supabase.from('stock_subtypes')
      .insert({ asset_id: asset.id, subtype: 'Market' }).select('id').single()
    if (sErr) throw new Error(`Failed to create subtype: ${sErr.message}`)

    const { data: tx, error: txErr } = await supabase.from('transactions').insert({
      subtype_id: subtype.id, count: 10, cost_price: 50,
      purchase_date: purchaseDate, capital_gains_status: 'Short Term',
    }).select('id').single()
    if (txErr) throw new Error(`Failed to create transaction: ${txErr.message}`)

    // Promote to Long Term (simulates what the edge function does)
    await supabase.from('transactions').update({ capital_gains_status: 'Long Term' }).eq('id', tx.id)

    const { data: pushResult, error: pushErr } = await supabase.functions.invoke('send-push', {
      body: { user_id: userId, title: 'Capital Gains Update', body: '1 lot promoted to Long Term' },
    })
    localStorage.setItem('__push_debug', JSON.stringify({ pushResult, pushErr, ts: Date.now() }))
  }

  if (type === 'price_movement') {
    const { data: settings } = await supabase.from('user_settings')
      .select('price_alert_threshold').eq('user_id', userId).maybeSingle()
    const threshold = Number(settings?.price_alert_threshold ?? 5)
    const changePct = threshold + 1
    const oldPrice = 100
    const newPrice = parseFloat((oldPrice * (1 + changePct / 100)).toFixed(2))

    await supabase.from('tickers')
      .upsert(
        { user_id: userId, symbol: 'DEMO', current_price: newPrice, last_updated: today, watchlist_only: false },
        { onConflict: 'user_id,symbol' },
      )

    await supabase.functions.invoke('send-push', {
      body: {
        user_id: userId,
        title: `DEMO moved ▲${changePct.toFixed(1)}%`,
        body: `$${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}`,
      },
    })
  }

  if (type === 'rsu_grant') {
    const { data: settings } = await supabase.from('user_settings')
      .select('rsu_alert_days_before').eq('user_id', userId).maybeSingle()
    const daysAhead = Number(settings?.rsu_alert_days_before ?? 30)
    const vestEnd = new Date()
    vestEnd.setDate(vestEnd.getDate() + daysAhead - 1)
    const vestEndStr = vestEnd.toISOString().split('T')[0]

    const locationId = await findOrCreateLocation(userId, 'Demo Corp', 'Investment')
    const { data: ticker, error: tErr } = await supabase.from('tickers')
      .upsert({ user_id: userId, symbol: 'DEMO', watchlist_only: false }, { onConflict: 'user_id,symbol' })
      .select('id').single()
    if (tErr) throw new Error(`Failed to upsert ticker: ${tErr.message}`)

    const { data: asset, error: aErr } = await supabase.from('assets').insert({
      user_id: userId, name: 'Demo RSU Grant', asset_type: 'Stock',
      location_id: locationId, ownership: 'Individual', ticker_id: ticker.id,
    }).select('id').single()
    if (aErr) throw new Error(`Failed to create asset: ${aErr.message}`)

    const { data: subtype, error: sErr } = await supabase.from('stock_subtypes')
      .insert({ asset_id: asset.id, subtype: 'RSU' }).select('id').single()
    if (sErr) throw new Error(`Failed to create subtype: ${sErr.message}`)

    await supabase.from('rsu_grants').insert({
      subtype_id: subtype.id,
      grant_date: today,
      total_shares: 100,
      vest_start: today,
      vest_end: vestEndStr,
    })

    await supabase.functions.invoke('send-push', {
      body: {
        user_id: userId,
        title: 'RSU Grant Vesting Soon',
        body: `Demo RSU Grant: 100 shares vest on ${vestEndStr}`,
      },
    })
  }
}

export async function runCommand(messages: Message[]): Promise<any> {
  const lastUserContent = messages.findLast(m => m.role === 'user')?.content ?? ''
  const traceSteps: AgentTraceStep[] = []
  const addTrace = (label: string, detail?: string) => {
    traceSteps.push({ label, ...(detail ? { detail } : {}) })
  }
  const withTrace = (payload: any) => ({
    ...payload,
    trace: {
      generatedAt: new Date().toISOString(),
      steps: traceSteps,
    } as AgentTrace,
  })

  addTrace('Received user command', clipText(lastUserContent, 180))
  if (/^create:mock_data$/i.test(lastUserContent)) return createMockDataCommand()
  if (/^delete:all_data$/i.test(lastUserContent)) return deleteAllDataCommand()
  const notifMatch = /^create:mock_notification:(capital_gains|price_movement|rsu_grant)$/i.exec(lastUserContent)
  if (notifMatch) return createMockNotificationCommand(notifMatch[1].toLowerCase())

  const previousMessage = messages[messages.length - 2]
  const justAskedTransfer =
    previousMessage?.role === 'assistant' && isTransferProceedsPrompt(previousMessage.content)
  if (isSaleUtterance(lastUserContent) && !mentionsTransferIntent(lastUserContent) && !justAskedTransfer) {
    addTrace('Requested sale-proceeds clarification')
    return withTrace({
      type: 'text',
      message: 'Do you want to transfer the sale proceeds somewhere? Reply with destination (and optional amount), or say "no transfer".',
    })
  }

  const [assets, allTickers, { data: { user } }] = await Promise.all([
    getAllAssets(),
    getAllTickers(),
    getSupabaseClient().auth.getUser(),
  ])
  addTrace('Loaded portfolio state', `${assets.length} asset(s), ${allTickers.length} ticker(s)`)

  const userName = (user?.user_metadata?.full_name ?? user?.user_metadata?.name)
    ?.split(' ')[0] as string | undefined
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })
  const baseSystemPrompt = buildSystemPrompt(assets, userName)

  const runClaude = async (systemPrompt: string, inputMessages: any) => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: inputMessages,
    tools,
  })

  const shouldAttachComputedContext = isAnalyticalQuestion(lastUserContent) || mentionsNetWorth(lastUserContent)
  const analysisContext = shouldAttachComputedContext
    ? buildFocusedPortfolioContext(lastUserContent, assets, allTickers, false)
    : null
  if (analysisContext) {
    addTrace('Attached computed portfolio context', mentionsNetWorth(lastUserContent) ? 'Net-worth directive enabled' : undefined)
  }

  let systemPrompt = baseSystemPrompt
  if (analysisContext) {
    const netWorthDirective = mentionsNetWorth(lastUserContent)
      ? '\nFor net worth questions, use summary.totalNetWorth from the computed context exactly.'
      : ''
    systemPrompt = `${baseSystemPrompt}

Use the computed portfolio context below for read-only analysis questions. Prefer this context over asking the user for details that are already present.
${netWorthDirective}
Computed Portfolio Context (JSON):
${JSON.stringify(analysisContext, null, 2)}`
  }

  let claudeMessages: any[] = [...messages]
  let response = await runClaude(systemPrompt, claudeMessages)
  addTrace('Initial model pass complete')

  let snapshotsCache: any[] | null = null
  const getSnapshotsCached = async () => {
    if (snapshotsCache) return snapshotsCache
    try {
      snapshotsCache = await getSnapshots()
    } catch (error) {
      console.warn('Failed to load net worth snapshots for read tool', error)
      snapshotsCache = []
    }
    return snapshotsCache
  }

  const maxReadToolRounds = 3
  for (let round = 0; round < maxReadToolRounds; round += 1) {
    const toolUsesInRound = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUsesInRound.length === 0) {
      addTrace('No read tools requested', `Round ${round + 1}`)
      break
    }

    const readToolUses = toolUsesInRound.filter((tool) => READ_TOOL_NAMES.has(tool.name))
    const hasNonReadToolUse = toolUsesInRound.some((tool) => !READ_TOOL_NAMES.has(tool.name))
    if (readToolUses.length === 0 || hasNonReadToolUse) {
      if (hasNonReadToolUse) {
        addTrace('Stopped read-tool loop', 'Model requested navigation or write tools')
      }
      break
    }

    addTrace('Executing read tools', `Round ${round + 1}, ${readToolUses.length} tool call(s)`)

    const toolResultBlocks = await Promise.all(readToolUses.map(async (tool) => {
      try {
        const result = await executeReadTool(tool.name, tool.input, {
          assets,
          getSnapshotsCached,
        })
        addTrace(
          `Read tool: ${tool.name}`,
          `${summarizeReadToolResult(tool.name, result)}${tool.input ? ` | input ${clipText(tool.input, 120)}` : ''}`,
        )
        return {
          type: 'tool_result' as const,
          tool_use_id: tool.id,
          content: JSON.stringify({ ok: true, result }),
        }
      } catch (error: any) {
        addTrace(`Read tool failed: ${tool.name}`, String(error?.message ?? 'Read tool failed'))
        return {
          type: 'tool_result' as const,
          tool_use_id: tool.id,
          content: JSON.stringify({ ok: false, error: String(error?.message ?? 'Read tool failed') }),
        }
      }
    }))

    claudeMessages = [
      ...claudeMessages,
      { role: 'assistant', content: response.content as any },
      { role: 'user', content: toolResultBlocks as any },
    ]
    response = await runClaude(systemPrompt, claudeMessages)
    addTrace('Model re-run with read tool results', `Round ${round + 1}`)
  }

  const maxReasoningSteps = 2
  for (let step = 0; step < maxReasoningSteps; step += 1) {
    const toolUsesInLoop = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUsesInLoop.length > 0) {
      addTrace('Exited clarification loop', 'Model emitted tool calls')
      break
    }

    const assistantText = extractTextFromClaudeResponse(response)
    if (!looksLikePortfolioDetailQuestion(assistantText)) {
      addTrace('Clarification loop not needed')
      break
    }

    const expandedContext = buildFocusedPortfolioContext(lastUserContent, assets, allTickers, true)
    const hiddenFollowUp = `Use this computed portfolio context and answer the user's original question.
Do not ask the user for portfolio details that are already included here.
If data is still missing after reviewing this context, state assumptions clearly and proceed with best-effort analysis.

Computed Portfolio Context (JSON):
${JSON.stringify(expandedContext, null, 2)}`
    addTrace('Triggered hidden follow-up reasoning pass', `Step ${step + 1}`)

    claudeMessages = [
      ...claudeMessages,
      { role: 'assistant', content: assistantText },
      { role: 'user', content: hiddenFollowUp },
    ]
    response = await runClaude(baseSystemPrompt, claudeMessages)
    addTrace('Model re-run with expanded context', `Step ${step + 1}`)
  }

  const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (toolUses.length === 0) {
    const text = extractTextFromClaudeResponse(response)
    addTrace('Returned final text response')
    return withTrace({ type: 'text', message: text || 'Could not understand command' })
  }

  const navigateTool = toolUses.find((tool) => tool.name === 'navigate_to')
  const writeTools = toolUses.filter((tool) => WRITE_TOOL_NAMES.has(tool.name))

  if (writeTools.length === 0 && navigateTool) {
    addTrace('Performed navigation', String((navigateTool.input as any).route ?? ''))
    window.location.href = (navigateTool.input as any).route
    return { type: 'navigate', route: (navigateTool.input as any).route }
  }

  if (writeTools.length === 0) {
    const text = extractTextFromClaudeResponse(response)
    addTrace('Returned final text response')
    return withTrace({ type: 'text', message: text || 'Could not understand command' })
  }

  const buildWriteConfirmation = (name: string, input: any) => ({
    confirmationMessage: confirmationMessageFor(name, input),
    execute: async () => {
      const supabase = getSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeTool(name, input, user.id)
    },
  })

  const confirmations = writeTools.map((tool) => buildWriteConfirmation(tool.name, tool.input))
  if (confirmations.length === 1) {
    addTrace('Prepared one write confirmation', writeTools[0]?.name)
    return {
      type: 'write_confirm',
      ...confirmations[0],
    }
  }

  addTrace('Prepared write confirmation queue', `${confirmations.length} action(s)`)
  return {
    type: 'write_confirm_queue',
    confirmations,
  }
}
