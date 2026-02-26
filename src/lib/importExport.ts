// src/lib/importExport.ts
import { getAllAssets } from './db/assets'
import { getAllTickers } from './db/tickers'
import { getAllThemes } from './db/themes'
import { findOrCreateLocation } from './db/locations'
import { autoAssignThemesForTicker, isAutoThemeAssignmentEnabled } from './autoThemes'
import { showAppAlert } from './appAlerts'
import { getSupabaseClient } from './supabase'

const EXPORT_SCHEMA = 'mne.export.v2'
const EXPORT_VERSION = '2.0'
let activeImportController: AbortController | null = null

export function setActiveImportController(controller: AbortController | null) {
  activeImportController = controller
}

export function abortActiveImport() {
  activeImportController?.abort()
}

type Ownership = 'Individual' | 'Joint'
type StockSubtypeName = 'Market' | 'ESPP' | 'RSU'
type CapitalGainsStatus = 'Short Term' | 'Long Term'

type ParsedLocation = {
  id?: string
  name: string
  accountType: string
}

type ParsedTheme = {
  id?: string
  name: string
}

type ParsedTicker = {
  id?: string
  symbol: string
  currentPrice: number | null
  lastUpdated: string | null
  logo: string | null
  watchlistOnly: boolean
}

type ParsedTickerTheme = {
  tickerId?: string
  tickerSymbol?: string
  themeId?: string
  themeName?: string
}

type ParsedThemeTarget = {
  id?: string
  themeId?: string
  themeName?: string
  targetPercentage: number
  isActive: boolean
}

type ParsedTransaction = {
  id?: string
  count: number
  costPrice: number
  purchaseDate: string
  capitalGainsStatus: CapitalGainsStatus
}

type ParsedRsuGrant = {
  id?: string
  grantDate: string
  totalShares: number
  vestStart: string
  vestEnd: string
  cliffDate: string | null
  endedAt: string | null
}

type ParsedSubtype = {
  id?: string
  subtype: StockSubtypeName
  transactions: ParsedTransaction[]
  rsuGrants: ParsedRsuGrant[]
}

type ParsedAsset = {
  id?: string
  name: string
  assetType: string
  locationId?: string
  locationName: string
  accountType: string
  ownership: Ownership
  notes: string | null
  price: number | null
  initialPrice: number | null
  tickerId?: string | null
  tickerSymbol: string | null
  stockSubtypes: ParsedSubtype[]
}

type ParsedImport = {
  version: string
  exportDate: string | null
  locations: ParsedLocation[]
  tickers: ParsedTicker[]
  themes: ParsedTheme[]
  tickerThemes: ParsedTickerTheme[]
  themeTargets: ParsedThemeTarget[]
  assets: ParsedAsset[]
}

type CanonicalSubtypeRow = {
  id: string | undefined
  assetId: string
  subtype: StockSubtypeName
}

type CanonicalExportV2 = {
  schema: typeof EXPORT_SCHEMA
  version: typeof EXPORT_VERSION
  exportedAt: string
  data: {
    locations: ParsedLocation[]
    themes: ParsedTheme[]
    tickers: ParsedTicker[]
    tickerThemes: ParsedTickerTheme[]
    themeTargets: ParsedThemeTarget[]
    assets: Array<Omit<ParsedAsset, 'stockSubtypes'>>
    stockSubtypes: Array<{ id?: string; assetId: string; subtype: StockSubtypeName }>
    transactions: Array<Omit<ParsedTransaction, 'costPrice' | 'purchaseDate' | 'capitalGainsStatus'> & {
      subtypeId: string
      costPrice: number
      purchaseDate: string
      capitalGainsStatus: CapitalGainsStatus
    }>
    rsuGrants: Array<Omit<ParsedRsuGrant, 'grantDate' | 'totalShares' | 'vestStart' | 'vestEnd' | 'cliffDate' | 'endedAt'> & {
      subtypeId: string
      grantDate: string
      totalShares: number
      vestStart: string
      vestEnd: string
      cliffDate: string | null
      endedAt: string | null
    }>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return defaultValue
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeUuid(value: unknown): string | undefined {
  const raw = asString(value).toLowerCase()
  return isUuid(raw) ? raw : undefined
}

function toIsoDate(value: unknown): string | null {
  const input = asString(value)
  if (!input) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input

  const mmddyyyy = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mmddyyyy) {
    const month = Number(mmddyyyy[1])
    const day = Number(mmddyyyy[2])
    const year = Number(mmddyyyy[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    }
  }

  const mmddyy = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mmddyy) {
    const month = Number(mmddyy[1])
    const day = Number(mmddyy[2])
    const shortYear = Number(mmddyy[3])
    const year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    }
  }

  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().split('T')[0]
}

function normalizeAssetType(value: unknown): string {
  const normalized = asString(value).toLowerCase().replace(/\s+/g, '')
  if (normalized === '401(k)' || normalized === '401k') return '401k'
  if (normalized === 'cd') return 'CD'
  if (normalized === 'cash') return 'Cash'
  if (normalized === 'deposit') return 'Deposit'
  if (normalized === 'hsa') return 'HSA'
  if (normalized === 'stock') return 'Stock'
  return asString(value) || 'Other'
}

function normalizeAccountType(value: unknown): string {
  const raw = asString(value)
  const normalized = raw.toLowerCase()
  if (normalized.includes('invest') || normalized.includes('broker')) return 'Investment'
  if (normalized.includes('check')) return 'Checking'
  if (normalized.includes('sav')) return 'Savings'
  if (normalized.includes('misc')) return 'Misc'
  return raw || 'Investment'
}

function normalizeOwnership(value: unknown): Ownership {
  return asString(value).toLowerCase().startsWith('joint') ? 'Joint' : 'Individual'
}

function normalizeSubtype(value: unknown, hasRsuGrants: boolean): StockSubtypeName {
  if (hasRsuGrants) return 'RSU'
  const normalized = asString(value).toUpperCase()
  if (normalized === 'ESPP') return 'ESPP'
  if (normalized === 'RSU') return 'RSU'
  return 'Market'
}

function normalizeCapitalGainsStatus(value: unknown, purchaseDate: string): CapitalGainsStatus {
  const normalized = asString(value).toLowerCase()
  if (normalized.includes('long')) return 'Long Term'
  if (normalized.includes('short')) return 'Short Term'

  const purchase = new Date(`${purchaseDate}T00:00:00`)
  if (Number.isNaN(purchase.getTime())) return 'Short Term'
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  return purchase < oneYearAgo ? 'Long Term' : 'Short Term'
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = keyFn(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function normalizeLocation(raw: unknown): ParsedLocation | null {
  if (!isRecord(raw)) return null
  const name = asString(raw.name)
  if (!name) return null
  return {
    id: normalizeUuid(raw.id),
    name,
    accountType: normalizeAccountType(raw.accountType ?? raw.account_type),
  }
}

function normalizeTheme(raw: unknown): ParsedTheme | null {
  if (!isRecord(raw)) return null
  const name = asString(raw.name)
  if (!name) return null
  return {
    id: normalizeUuid(raw.id),
    name,
  }
}

function normalizeTicker(rawTicker: unknown): ParsedTicker | null {
  if (!isRecord(rawTicker)) return null
  const symbol = asString(rawTicker.symbol).toUpperCase()
  if (!symbol) return null
  return {
    id: normalizeUuid(rawTicker.id),
    symbol,
    currentPrice: asNumber(rawTicker.currentPrice ?? rawTicker.current_price),
    lastUpdated: toIsoDate(rawTicker.lastUpdated ?? rawTicker.last_updated),
    logo: asString(rawTicker.logo) || null,
    watchlistOnly: asBoolean(rawTicker.watchlistOnly ?? rawTicker.watchlist_only, false),
  }
}

function normalizeTickerTheme(raw: unknown): ParsedTickerTheme | null {
  if (!isRecord(raw)) return null
  const tickerId = normalizeUuid(raw.tickerId ?? raw.ticker_id)
  const tickerSymbol = asString(raw.tickerSymbol ?? raw.ticker_symbol).toUpperCase() || undefined
  const themeId = normalizeUuid(raw.themeId ?? raw.theme_id)
  const themeName = asString(raw.themeName ?? raw.theme_name) || undefined
  if (!tickerId && !tickerSymbol) return null
  if (!themeId && !themeName) return null
  return { tickerId, tickerSymbol, themeId, themeName }
}

function normalizeThemeTarget(raw: unknown): ParsedThemeTarget | null {
  if (!isRecord(raw)) return null
  const targetPercentage = asNumber(raw.targetPercentage ?? raw.target_percentage)
  if (targetPercentage == null) return null
  const themeId = normalizeUuid(raw.themeId ?? raw.theme_id)
  const themeName = asString(raw.themeName ?? raw.theme_name) || undefined
  if (!themeId && !themeName) return null
  return {
    id: normalizeUuid(raw.id),
    themeId,
    themeName,
    targetPercentage,
    isActive: asBoolean(raw.isActive ?? raw.is_active, true),
  }
}

function normalizeTransactions(rawTransactions: unknown[]): ParsedTransaction[] {
  const results: ParsedTransaction[] = []
  for (const entry of rawTransactions) {
    if (!isRecord(entry)) continue
    const count = asNumber(entry.count)
    const costPrice = asNumber(entry.costPrice ?? entry.cost_price)
    const purchaseDate = toIsoDate(entry.purchaseDate ?? entry.purchase_date)
    if (!count || count <= 0 || costPrice == null || costPrice < 0 || !purchaseDate) continue
    results.push({
      id: normalizeUuid(entry.id),
      count,
      costPrice,
      purchaseDate,
      capitalGainsStatus: normalizeCapitalGainsStatus(
        entry.capitalGainsStatus ?? entry.capital_gains_status,
        purchaseDate,
      ),
    })
  }
  return results
}

function normalizeRsuGrants(rawGrants: unknown[]): ParsedRsuGrant[] {
  const results: ParsedRsuGrant[] = []
  for (const entry of rawGrants) {
    if (!isRecord(entry)) continue
    const txList = normalizeTransactions(asArray(entry.transactions))
    const sortedTxDates = txList
      .map((tx) => tx.purchaseDate)
      .filter(Boolean)
      .sort()
    const earliestTxDate = sortedTxDates[0] ?? null
    const latestTxDate = sortedTxDates[sortedTxDates.length - 1] ?? null

    const rawGrantDate = toIsoDate(entry.grantDate ?? entry.grant_date)
    const rawVestStart = toIsoDate(entry.vestStart ?? entry.vest_start ?? entry.grantDate ?? entry.grant_date)
    const rawVestEnd = toIsoDate(
      entry.vestEnd
      ?? entry.vest_end
      ?? entry.firstVestingDate
      ?? entry.first_vest_date
      ?? entry.vestStart
      ?? entry.vest_start
      ?? entry.grantDate
      ?? entry.grant_date,
    )

    const grantDate = rawGrantDate ?? rawVestStart ?? rawVestEnd ?? earliestTxDate
    const vestStart = rawVestStart ?? grantDate ?? earliestTxDate ?? latestTxDate
    const vestEnd = rawVestEnd ?? latestTxDate ?? vestStart ?? grantDate
    if (!grantDate || !vestStart || !vestEnd) continue

    const txShares = txList.reduce((sum, tx) => sum + tx.count, 0)
    const unvestedCount = asNumber(entry.unvestedCount ?? entry.unvested_count) ?? 0
    const explicitTotalShares = asNumber(entry.totalShares ?? entry.total_shares)
    const inferredTotalShares = Math.max(txShares + Math.max(0, unvestedCount), txShares, Math.max(0, unvestedCount))
    const totalShares = explicitTotalShares ?? inferredTotalShares

    results.push({
      id: normalizeUuid(entry.id),
      grantDate,
      totalShares: totalShares && totalShares > 0 ? totalShares : Math.max(txShares, 1),
      vestStart,
      vestEnd,
      cliffDate: toIsoDate(entry.cliffDate ?? entry.cliff_date ?? entry.firstVestingDate ?? entry.first_vest_date),
      endedAt: toIsoDate(entry.endedAt ?? entry.ended_at),
    })
  }
  return results
}

function normalizeSubtypes(rawSubtypes: unknown[]): ParsedSubtype[] {
  const results: ParsedSubtype[] = []
  for (const entry of rawSubtypes) {
    if (!isRecord(entry)) continue
    const rawRsuGrants = asArray(entry.rsuGrants ?? entry.rsu_grants)
    const rsuGrants = normalizeRsuGrants(rawRsuGrants)
    const subtypeTransactions = normalizeTransactions(asArray(entry.transactions))
    const grantTransactions = rawRsuGrants.flatMap((grant) => {
      if (!isRecord(grant)) return []
      return normalizeTransactions(asArray(grant.transactions))
    })
    const mergedTransactions = [...subtypeTransactions]
    const seenTx = new Set(mergedTransactions.map((tx) => tx.id ?? `${tx.purchaseDate}:${tx.count}:${tx.costPrice}`))
    for (const tx of grantTransactions) {
      const key = tx.id ?? `${tx.purchaseDate}:${tx.count}:${tx.costPrice}`
      if (seenTx.has(key)) continue
      seenTx.add(key)
      mergedTransactions.push(tx)
    }
    const subtype = normalizeSubtype(entry.subtype, rsuGrants.length > 0)
    if (subtype === 'RSU' && rsuGrants.length === 0 && mergedTransactions.length > 0) {
      const sortedTxDates = mergedTransactions.map((tx) => tx.purchaseDate).filter(Boolean).sort()
      const start = sortedTxDates[0] ?? new Date().toISOString().split('T')[0]
      const end = sortedTxDates[sortedTxDates.length - 1] ?? start
      rsuGrants.push({
        grantDate: start,
        vestStart: start,
        vestEnd: end,
        totalShares: mergedTransactions.reduce((sum, tx) => sum + tx.count, 0),
        cliffDate: null,
        endedAt: null,
      })
    }
    results.push({
      id: normalizeUuid(entry.id),
      subtype,
      transactions: mergedTransactions,
      rsuGrants,
    })
  }
  return results
}

function normalizeLegacyMneExport(data: Record<string, unknown>): ParsedImport {
  const locations: ParsedLocation[] = []
  const tickers: ParsedTicker[] = []
  const themes: ParsedTheme[] = []
  const tickerThemes: ParsedTickerTheme[] = []
  const themeTargets: ParsedThemeTarget[] = []

  const addTheme = (theme: ParsedTheme) => {
    if (!theme.name) return
    themes.push(theme)
  }

  for (const themeEntry of asArray(data.themes)) {
    const theme = normalizeTheme(themeEntry)
    if (!theme) continue
    addTheme(theme)
    if (isRecord(themeEntry)) {
      for (const targetEntry of asArray(themeEntry.theme_targets ?? themeEntry.themeTargets)) {
        const target = normalizeThemeTarget({
          ...targetEntry as Record<string, unknown>,
          themeId: (targetEntry as any)?.theme_id ?? theme.id,
          themeName: (targetEntry as any)?.theme_name ?? theme.name,
        })
        if (target) themeTargets.push(target)
      }
    }
  }

  for (const tickerEntry of asArray(data.tickers)) {
    const ticker = normalizeTicker(tickerEntry)
    if (!ticker) continue
    tickers.push(ticker)
    if (!isRecord(tickerEntry)) continue
    for (const linkEntry of asArray(tickerEntry.ticker_themes ?? tickerEntry.tickerThemes)) {
      if (!isRecord(linkEntry)) continue
      const themeObj = isRecord(linkEntry.theme) ? linkEntry.theme : {}
      const themeName = asString(themeObj.name ?? linkEntry.theme_name ?? linkEntry.themeName)
      const themeId = normalizeUuid(themeObj.id ?? linkEntry.theme_id ?? linkEntry.themeId)
      if (themeName) addTheme({ id: themeId, name: themeName })
      const link = normalizeTickerTheme({
        tickerId: normalizeUuid(linkEntry.ticker_id ?? linkEntry.tickerId) ?? ticker.id,
        tickerSymbol: ticker.symbol,
        themeId,
        themeName,
      })
      if (link) tickerThemes.push(link)
    }
  }

  const assets: ParsedAsset[] = asArray(data.assets).map((entry) => {
    const item = isRecord(entry) ? entry : {}
    const location = isRecord(item.location) ? item.location : {}
    const ticker = isRecord(item.ticker) ? item.ticker : {}
    const locationName = asString(location.name ?? item.location_name ?? item.locationName) || 'Imported'
    const accountType = normalizeAccountType(location.account_type ?? item.account_type ?? item.locationAccountType)
    const locationId = normalizeUuid(location.id ?? item.location_id)
    if (locationName) locations.push({ id: locationId, name: locationName, accountType })

    return {
      id: normalizeUuid(item.id),
      name: asString(item.name) || 'Imported Asset',
      assetType: normalizeAssetType(item.asset_type ?? item.assetTypeName),
      locationId,
      locationName,
      accountType,
      ownership: normalizeOwnership(item.ownership),
      notes: asString(item.notes) || null,
      price: asNumber(item.price),
      initialPrice: asNumber(item.initial_price ?? item.initialPrice ?? item.price),
      tickerId: normalizeUuid(item.ticker_id ?? ticker.id) ?? undefined,
      tickerSymbol: asString(ticker.symbol ?? item.ticker).toUpperCase() || null,
      stockSubtypes: normalizeSubtypes(asArray(item.stock_subtypes ?? item.stockSubtypes)),
    }
  })

  return {
    version: asString(data.version) || '1.0',
    exportDate: toIsoDate(data.exportDate ?? data.export_date),
    locations: dedupeBy(locations, (l) => `${l.name.toLowerCase()}::${l.accountType.toLowerCase()}`),
    tickers: dedupeBy(tickers, (t) => t.symbol.toUpperCase()),
    themes: dedupeBy(themes, (t) => t.name.toLowerCase()),
    tickerThemes: dedupeBy(
      tickerThemes,
      (tt) => `${(tt.tickerId ?? tt.tickerSymbol ?? '').toLowerCase()}::${(tt.themeId ?? tt.themeName ?? '').toLowerCase()}`,
    ),
    themeTargets: dedupeBy(
      themeTargets,
      (target) => `${(target.themeId ?? target.themeName ?? '').toLowerCase()}`,
    ),
    assets,
  }
}

function normalizeMoolaExport(data: Record<string, unknown>): ParsedImport {
  const locations: ParsedLocation[] = []
  const tickers: ParsedTicker[] = []
  const themes: ParsedTheme[] = []
  const tickerThemes: ParsedTickerTheme[] = []
  const themeTargets: ParsedThemeTarget[] = []

  const addThemeName = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    themes.push({ name: trimmed })
  }

  for (const locationEntry of asArray(data.locations)) {
    const location = normalizeLocation(locationEntry)
    if (location) locations.push(location)
  }

  for (const tickerEntry of asArray(data.stockTickers)) {
    const ticker = normalizeTicker(tickerEntry)
    if (!ticker) continue
    tickers.push(ticker)
    if (!isRecord(tickerEntry)) continue
    for (const themeName of asArray(tickerEntry.themeNames).map(asString).filter(Boolean)) {
      addThemeName(themeName)
      tickerThemes.push({
        tickerId: ticker.id,
        tickerSymbol: ticker.symbol,
        themeName,
      })
    }
  }

  for (const targetEntry of asArray(data.themeAllocationTargets)) {
    if (!isRecord(targetEntry)) continue
    const target = normalizeThemeTarget({
      id: targetEntry.id,
      themeName: targetEntry.themeName,
      targetPercentage: targetEntry.targetPercentage,
      isActive: targetEntry.isActive,
    })
    if (target) {
      themeTargets.push(target)
      if (target.themeName) addThemeName(target.themeName)
    }
  }

  const tickersBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]))

  const assets: ParsedAsset[] = asArray(data.assets).map((entry) => {
    const item = isRecord(entry) ? entry : {}
    const tickerSymbol = asString(item.ticker).toUpperCase()
    const locationName = asString(item.locationName ?? item.location_name) || 'Imported'
    const accountType = normalizeAccountType(item.locationAccountType ?? item.account_type)
    if (locationName) locations.push({ name: locationName, accountType })

    return {
      id: normalizeUuid(item.id),
      name: asString(item.name) || 'Imported Asset',
      assetType: normalizeAssetType(item.assetTypeName ?? item.asset_type),
      locationName,
      accountType,
      ownership: normalizeOwnership(item.ownership),
      notes: asString(item.notes) || null,
      price: asNumber(item.price) ?? tickersBySymbol.get(tickerSymbol)?.currentPrice ?? null,
      initialPrice: asNumber(item.initialPrice ?? item.initial_price ?? item.price),
      tickerSymbol: tickerSymbol || null,
      stockSubtypes: normalizeSubtypes(asArray(item.stockSubtypes ?? item.stock_subtypes)),
    }
  })

  return {
    version: asString(data.version) || '1.0',
    exportDate: toIsoDate(data.exportDate ?? data.export_date),
    locations: dedupeBy(locations, (l) => `${l.name.toLowerCase()}::${l.accountType.toLowerCase()}`),
    tickers: dedupeBy(tickers, (t) => t.symbol.toUpperCase()),
    themes: dedupeBy(themes, (t) => t.name.toLowerCase()),
    tickerThemes: dedupeBy(
      tickerThemes,
      (tt) => `${(tt.tickerId ?? tt.tickerSymbol ?? '').toLowerCase()}::${(tt.themeId ?? tt.themeName ?? '').toLowerCase()}`,
    ),
    themeTargets: dedupeBy(
      themeTargets,
      (target) => `${(target.themeId ?? target.themeName ?? '').toLowerCase()}`,
    ),
    assets,
  }
}

function normalizeCanonicalExport(root: Record<string, unknown>): ParsedImport {
  const data = isRecord(root.data) ? root.data : {}

  const locations = dedupeBy(
    asArray(data.locations).map(normalizeLocation).filter((value): value is ParsedLocation => value !== null),
    (location) => `${location.name.toLowerCase()}::${location.accountType.toLowerCase()}`,
  )
  const locationById = new Map(
    locations
      .filter((location) => Boolean(location.id))
      .map((location) => [location.id!, location]),
  )

  const tickers = dedupeBy(
    asArray(data.tickers).map(normalizeTicker).filter((value): value is ParsedTicker => value !== null),
    (ticker) => ticker.symbol.toUpperCase(),
  )
  const tickerById = new Map(
    tickers
      .filter((ticker) => Boolean(ticker.id))
      .map((ticker) => [ticker.id!, ticker]),
  )

  const themes = dedupeBy(
    asArray(data.themes).map(normalizeTheme).filter((value): value is ParsedTheme => value !== null),
    (theme) => theme.name.toLowerCase(),
  )

  const tickerThemes = dedupeBy(
    asArray(data.tickerThemes ?? data.ticker_themes)
      .map(normalizeTickerTheme)
      .filter((value): value is ParsedTickerTheme => value !== null),
    (link) => `${(link.tickerId ?? link.tickerSymbol ?? '').toLowerCase()}::${(link.themeId ?? link.themeName ?? '').toLowerCase()}`,
  )

  const themeTargets = dedupeBy(
    asArray(data.themeTargets ?? data.theme_targets)
      .map(normalizeThemeTarget)
      .filter((value): value is ParsedThemeTarget => value !== null),
    (target) => `${(target.themeId ?? target.themeName ?? '').toLowerCase()}`,
  )

  const assetRows = asArray(data.assets)
    .filter((entry) => isRecord(entry))
    .map((entry) => entry as Record<string, unknown>)

  const subtypeRows: CanonicalSubtypeRow[] = asArray(data.stockSubtypes ?? data.stock_subtypes)
    .filter((entry) => isRecord(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>
      const assetId = normalizeUuid(row.assetId ?? row.asset_id)
      if (!assetId) return null
      return {
        id: normalizeUuid(row.id),
        assetId,
        subtype: normalizeSubtype(row.subtype, false),
      }
    })
    .filter((value): value is CanonicalSubtypeRow => value !== null)

  const txBySubtype = new Map<string, ParsedTransaction[]>()
  for (const txEntry of asArray(data.transactions)) {
    if (!isRecord(txEntry)) continue
    const subtypeId = normalizeUuid(txEntry.subtypeId ?? txEntry.subtype_id)
    if (!subtypeId) continue
    const tx = normalizeTransactions([txEntry])[0]
    if (!tx) continue
    const list = txBySubtype.get(subtypeId) ?? []
    list.push(tx)
    txBySubtype.set(subtypeId, list)
  }

  const grantsBySubtype = new Map<string, ParsedRsuGrant[]>()
  for (const grantEntry of asArray(data.rsuGrants ?? data.rsu_grants)) {
    if (!isRecord(grantEntry)) continue
    const subtypeId = normalizeUuid(grantEntry.subtypeId ?? grantEntry.subtype_id)
    if (!subtypeId) continue
    const grant = normalizeRsuGrants([grantEntry])[0]
    if (!grant) continue
    const list = grantsBySubtype.get(subtypeId) ?? []
    list.push(grant)
    grantsBySubtype.set(subtypeId, list)
  }

  const subtypesByAsset = new Map<string, ParsedSubtype[]>()
  for (const subtype of subtypeRows) {
    const transactions = (txBySubtype.get(subtype.id ?? '') ?? []).slice()
    const rsuGrants = (grantsBySubtype.get(subtype.id ?? '') ?? []).slice()
    const list = subtypesByAsset.get(subtype.assetId) ?? []
    list.push({
      id: subtype.id,
      subtype: subtype.subtype,
      transactions,
      rsuGrants,
    })
    subtypesByAsset.set(subtype.assetId, list)
  }

  const assets: ParsedAsset[] = assetRows.map((row) => {
    const locationId = normalizeUuid(row.locationId ?? row.location_id)
    const tickerId = normalizeUuid(row.tickerId ?? row.ticker_id)
    const linkedLocation = locationId ? locationById.get(locationId) : undefined
    const linkedTicker = tickerId ? tickerById.get(tickerId) : undefined
    const locationName = asString(row.locationName ?? row.location_name) || linkedLocation?.name || 'Imported'
    const accountType = normalizeAccountType(row.accountType ?? row.account_type ?? linkedLocation?.accountType)
    return {
      id: normalizeUuid(row.id),
      name: asString(row.name) || 'Imported Asset',
      assetType: normalizeAssetType(row.assetType ?? row.asset_type),
      locationId,
      locationName,
      accountType,
      ownership: normalizeOwnership(row.ownership),
      notes: asString(row.notes) || null,
      price: asNumber(row.price),
      initialPrice: asNumber(row.initialPrice ?? row.initial_price ?? row.price),
      tickerId,
      tickerSymbol: asString(row.tickerSymbol ?? row.ticker_symbol).toUpperCase() || linkedTicker?.symbol || null,
      stockSubtypes: (subtypesByAsset.get(normalizeUuid(row.id) ?? '') ?? []).map((st) => ({
        ...st,
        transactions: [...st.transactions].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
        rsuGrants: [...st.rsuGrants].sort((a, b) => b.grantDate.localeCompare(a.grantDate)),
      })),
    }
  })

  return {
    version: asString(root.version) || EXPORT_VERSION,
    exportDate: toIsoDate(root.exportedAt ?? root.exportDate ?? root.export_date),
    locations,
    tickers,
    themes,
    tickerThemes,
    themeTargets,
    assets,
  }
}

export function serializeForExport(data: { assets: any[]; tickers: any[]; themes: any[] }): CanonicalExportV2 {
  const locations: ParsedLocation[] = []
  const themes: ParsedTheme[] = []
  const tickers: ParsedTicker[] = []
  const tickerThemes: ParsedTickerTheme[] = []
  const themeTargets: ParsedThemeTarget[] = []
  const assets: Array<Omit<ParsedAsset, 'stockSubtypes'>> = []
  const stockSubtypes: Array<{ id?: string; assetId: string; subtype: StockSubtypeName }> = []
  const transactions: Array<{
    id?: string
    subtypeId: string
    count: number
    costPrice: number
    purchaseDate: string
    capitalGainsStatus: CapitalGainsStatus
  }> = []
  const rsuGrants: Array<{
    id?: string
    subtypeId: string
    grantDate: string
    totalShares: number
    vestStart: string
    vestEnd: string
    cliffDate: string | null
    endedAt: string | null
  }> = []

  const themeByName = new Map<string, ParsedTheme>()

  const registerTheme = (theme: ParsedTheme) => {
    const key = theme.name.toLowerCase()
    if (!key) return
    const existing = themeByName.get(key)
    if (!existing) {
      themeByName.set(key, theme)
      themes.push(theme)
      return
    }
    if (!existing.id && theme.id) {
      existing.id = theme.id
    }
  }

  for (const rawTheme of data.themes ?? []) {
    const theme = normalizeTheme(rawTheme)
    if (!theme) continue
    registerTheme(theme)
    if (!isRecord(rawTheme)) continue
    for (const targetEntry of asArray(rawTheme.theme_targets ?? rawTheme.themeTargets)) {
      const target = normalizeThemeTarget({
        ...targetEntry as Record<string, unknown>,
        themeId: (targetEntry as any)?.theme_id ?? theme.id,
        themeName: (targetEntry as any)?.theme_name ?? theme.name,
      })
      if (target) themeTargets.push(target)
    }
  }

  for (const rawTicker of data.tickers ?? []) {
    const ticker = normalizeTicker(rawTicker)
    if (!ticker) continue
    tickers.push(ticker)
    if (!isRecord(rawTicker)) continue
    for (const linkEntry of asArray(rawTicker.ticker_themes ?? rawTicker.tickerThemes)) {
      if (!isRecord(linkEntry)) continue
      const themeObj = isRecord(linkEntry.theme) ? linkEntry.theme : {}
      const theme = normalizeTheme({
        id: themeObj.id ?? linkEntry.theme_id ?? linkEntry.themeId,
        name: themeObj.name ?? linkEntry.theme_name ?? linkEntry.themeName,
      })
      if (theme) registerTheme(theme)

      const link = normalizeTickerTheme({
        tickerId: normalizeUuid(linkEntry.ticker_id ?? linkEntry.tickerId) ?? ticker.id,
        tickerSymbol: ticker.symbol,
        themeId: theme?.id ?? normalizeUuid(linkEntry.theme_id ?? linkEntry.themeId),
        themeName: theme?.name ?? asString(linkEntry.theme_name ?? linkEntry.themeName),
      })
      if (link) tickerThemes.push(link)
    }
  }

  for (const rawAsset of data.assets ?? []) {
    if (!isRecord(rawAsset)) continue
    const assetId = normalizeUuid(rawAsset.id)
    if (!assetId) continue

    const locationObj = isRecord(rawAsset.location) ? rawAsset.location : {}
    const locationId = normalizeUuid(rawAsset.location_id ?? locationObj.id)
    const locationName = asString(rawAsset.location_name ?? rawAsset.locationName ?? locationObj.name) || 'Imported'
    const accountType = normalizeAccountType(rawAsset.account_type ?? rawAsset.locationAccountType ?? locationObj.account_type)
    locations.push({ id: locationId, name: locationName, accountType })

    const tickerObj = isRecord(rawAsset.ticker) ? rawAsset.ticker : {}
    const tickerId = normalizeUuid(rawAsset.ticker_id ?? tickerObj.id)
    const tickerSymbol = asString(rawAsset.tickerSymbol ?? rawAsset.ticker ?? tickerObj.symbol).toUpperCase() || null

    assets.push({
      id: assetId,
      name: asString(rawAsset.name) || 'Imported Asset',
      assetType: normalizeAssetType(rawAsset.asset_type ?? rawAsset.assetTypeName),
      locationId,
      locationName,
      accountType,
      ownership: normalizeOwnership(rawAsset.ownership),
      notes: asString(rawAsset.notes) || null,
      price: asNumber(rawAsset.price),
      initialPrice: asNumber(rawAsset.initial_price ?? rawAsset.initialPrice ?? rawAsset.price),
      tickerId,
      tickerSymbol,
    })

    for (const rawSubtype of asArray(rawAsset.stock_subtypes ?? rawAsset.stockSubtypes)) {
      if (!isRecord(rawSubtype)) continue
      const subtypeId = normalizeUuid(rawSubtype.id)
      if (!subtypeId) continue
      const normalizedSubtype = normalizeSubtype(rawSubtype.subtype, asArray(rawSubtype.rsu_grants ?? rawSubtype.rsuGrants).length > 0)
      stockSubtypes.push({ id: subtypeId, assetId, subtype: normalizedSubtype })

      for (const tx of normalizeTransactions(asArray(rawSubtype.transactions))) {
        transactions.push({
          id: tx.id,
          subtypeId,
          count: tx.count,
          costPrice: tx.costPrice,
          purchaseDate: tx.purchaseDate,
          capitalGainsStatus: tx.capitalGainsStatus,
        })
      }

      for (const grant of normalizeRsuGrants(asArray(rawSubtype.rsu_grants ?? rawSubtype.rsuGrants))) {
        rsuGrants.push({
          id: grant.id,
          subtypeId,
          grantDate: grant.grantDate,
          totalShares: grant.totalShares,
          vestStart: grant.vestStart,
          vestEnd: grant.vestEnd,
          cliffDate: grant.cliffDate,
          endedAt: grant.endedAt,
        })
      }
    }
  }

  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      locations: dedupeBy(locations, (location) => `${location.name.toLowerCase()}::${location.accountType.toLowerCase()}`),
      themes: dedupeBy(themes, (theme) => theme.name.toLowerCase()),
      tickers: dedupeBy(tickers, (ticker) => ticker.symbol.toUpperCase()),
      tickerThemes: dedupeBy(
        tickerThemes,
        (link) => `${(link.tickerId ?? link.tickerSymbol ?? '').toLowerCase()}::${(link.themeId ?? link.themeName ?? '').toLowerCase()}`,
      ),
      themeTargets: dedupeBy(
        themeTargets,
        (target) => `${(target.themeId ?? target.themeName ?? '').toLowerCase()}`,
      ),
      assets,
      stockSubtypes,
      transactions,
      rsuGrants,
    },
  }
}

export function parseImport(raw: string): ParsedImport {
  const parsed = JSON.parse(raw) // throws on invalid JSON
  if (!isRecord(parsed)) throw new Error('Invalid format: expected a JSON object')

  if (asString(parsed.schema).toLowerCase() === EXPORT_SCHEMA) {
    return normalizeCanonicalExport(parsed)
  }

  if (!Array.isArray(parsed.assets)) {
    throw new Error('Invalid format: missing assets')
  }

  const firstAsset = parsed.assets.find((entry) => isRecord(entry)) as Record<string, unknown> | undefined
  if (!firstAsset) {
    return {
      version: asString(parsed.version) || '1.0',
      exportDate: toIsoDate(parsed.exportDate ?? parsed.export_date),
      locations: [],
      tickers: [],
      themes: [],
      tickerThemes: [],
      themeTargets: [],
      assets: [],
    }
  }

  if ('assetTypeName' in firstAsset || 'stockTickers' in parsed) {
    return normalizeMoolaExport(parsed)
  }

  if ('asset_type' in firstAsset || 'stock_subtypes' in firstAsset || 'location' in firstAsset) {
    return normalizeLegacyMneExport(parsed)
  }

  throw new Error('Invalid format: unsupported assets schema')
}

class ImportAbortedError extends Error {
  constructor() {
    super('Import aborted')
    this.name = 'ImportAbortedError'
  }
}

function throwIfImportAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ImportAbortedError()
}

function isImportAbortedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'ImportAbortedError' || name === 'AbortError'
}

export async function exportData() {
  const [assets, tickers, themes] = await Promise.all([getAllAssets(), getAllTickers(), getAllThemes()])
  const payload = serializeForExport({ assets, tickers, themes })
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mne-export-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importData(file: File, options: { signal?: AbortSignal } = {}) {
  const { signal } = options
  try {
    throwIfImportAborted(signal)
    const raw = await file.text()
    throwIfImportAborted(signal)
    const data = parseImport(raw)
    throwIfImportAborted(signal)
    const supabase = getSupabaseClient()

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    const userId = authData.user?.id
    if (!userId) throw new Error('Not authenticated')
    throwIfImportAborted(signal)

    const locationIdBySourceId = new Map<string, string>()
    const locationIdByKey = new Map<string, string>()
    const themeIdBySourceId = new Map<string, string>()
    const themeIdByName = new Map<string, string>()
    const tickerIdBySourceId = new Map<string, string>()
    const tickerIdBySymbol = new Map<string, string>()
    const tickerSymbolById = new Map<string, string>()

    let importedLocations = 0
    let importedThemes = 0
    let importedThemeTargets = 0
    let importedTickers = 0
    let importedTickerThemes = 0
    let importedAssets = 0
    let importedSubtypes = 0
    let importedTransactions = 0
    let importedRsuGrants = 0
    let autoAssignedTickerThemes = 0

    const locationKey = (name: string, accountType: string) => `${name.toLowerCase()}::${accountType.toLowerCase()}`

    async function ensureLocation(name: string, accountType: string, sourceId?: string) {
      throwIfImportAborted(signal)
      const key = locationKey(name, accountType)
      if (sourceId && locationIdBySourceId.has(sourceId)) return locationIdBySourceId.get(sourceId)!
      if (locationIdByKey.has(key)) {
        const existing = locationIdByKey.get(key)!
        if (sourceId) locationIdBySourceId.set(sourceId, existing)
        return existing
      }
      const id = await findOrCreateLocation(userId, name, accountType)
      throwIfImportAborted(signal)
      locationIdByKey.set(key, id)
      if (sourceId) locationIdBySourceId.set(sourceId, id)
      importedLocations += 1
      return id
    }

    async function ensureTheme(themeName?: string, sourceId?: string): Promise<string | null> {
      throwIfImportAborted(signal)
      const name = asString(themeName)
      if (sourceId && themeIdBySourceId.has(sourceId)) return themeIdBySourceId.get(sourceId)!
      if (name && themeIdByName.has(name.toLowerCase())) {
        const existing = themeIdByName.get(name.toLowerCase())!
        if (sourceId) themeIdBySourceId.set(sourceId, existing)
        return existing
      }
      if (!name) return null

      const { data: themeRow, error } = await supabase
        .from('themes')
        .upsert({ user_id: userId, name }, { onConflict: 'user_id,name' })
        .select('id')
        .single()
      throwIfImportAborted(signal)
      if (error) throw new Error(`Failed to upsert theme ${name}: ${error.message}`)

      themeIdByName.set(name.toLowerCase(), themeRow.id)
      if (sourceId) themeIdBySourceId.set(sourceId, themeRow.id)
      importedThemes += 1
      return themeRow.id
    }

    async function ensureTicker(params: {
      symbol?: string
      sourceId?: string
      currentPrice?: number | null
      lastUpdated?: string | null
      logo?: string | null
      watchlistOnly?: boolean
    }): Promise<string | null> {
      throwIfImportAborted(signal)
      const symbol = asString(params.symbol).toUpperCase()
      if (params.sourceId && tickerIdBySourceId.has(params.sourceId)) {
        const existing = tickerIdBySourceId.get(params.sourceId)!
        if (symbol) tickerSymbolById.set(existing, symbol)
        return existing
      }
      if (symbol && tickerIdBySymbol.has(symbol)) {
        const existing = tickerIdBySymbol.get(symbol)!
        if (params.sourceId) tickerIdBySourceId.set(params.sourceId, existing)
        tickerSymbolById.set(existing, symbol)
        return existing
      }
      if (!symbol) return null

      const payload: Record<string, unknown> = {
        user_id: userId,
        symbol,
        current_price: params.currentPrice ?? null,
        last_updated: params.lastUpdated ?? null,
        logo: params.logo ?? null,
        watchlist_only: asBoolean(params.watchlistOnly, true),
      }

      const { data: tickerRow, error } = await supabase
        .from('tickers')
        .upsert(payload, { onConflict: 'user_id,symbol' })
        .select('id')
        .single()
      throwIfImportAborted(signal)
      if (error) throw new Error(`Failed to upsert ticker ${symbol}: ${error.message}`)

      tickerIdBySymbol.set(symbol, tickerRow.id)
      if (params.sourceId) tickerIdBySourceId.set(params.sourceId, tickerRow.id)
      tickerSymbolById.set(tickerRow.id, symbol)
      importedTickers += 1
      return tickerRow.id
    }

    for (const location of data.locations) {
      throwIfImportAborted(signal)
      await ensureLocation(location.name, location.accountType, location.id)
    }

    for (const theme of data.themes) {
      throwIfImportAborted(signal)
      await ensureTheme(theme.name, theme.id)
    }

    for (const ticker of data.tickers) {
      throwIfImportAborted(signal)
      await ensureTicker({
        symbol: ticker.symbol,
        sourceId: ticker.id,
        currentPrice: ticker.currentPrice,
        lastUpdated: ticker.lastUpdated,
        logo: ticker.logo,
        watchlistOnly: ticker.watchlistOnly,
      })
    }

    for (const asset of data.assets) {
      throwIfImportAborted(signal)
      const locationId = asset.locationId
        ? locationIdBySourceId.get(asset.locationId) ?? await ensureLocation(asset.locationName, asset.accountType, asset.locationId)
        : await ensureLocation(asset.locationName, asset.accountType)

      const isStock = asset.assetType === 'Stock'
      let tickerId: string | null = null
      if (isStock) {
        throwIfImportAborted(signal)
        tickerId = await ensureTicker({
          symbol: asset.tickerSymbol ?? undefined,
          sourceId: asset.tickerId ?? undefined,
          currentPrice: asset.price,
          lastUpdated: data.exportDate,
          watchlistOnly: false,
        })
        if (tickerId) {
          throwIfImportAborted(signal)
          await supabase.from('tickers').update({ watchlist_only: false }).eq('id', tickerId)
        }
      }

      const assetPayload: Record<string, unknown> = {
        user_id: userId,
        name: asset.name,
        asset_type: asset.assetType,
        location_id: locationId,
        ownership: asset.ownership,
        notes: asset.notes,
        ticker_id: tickerId,
        price: isStock ? null : asset.price,
        initial_price: isStock ? null : (asset.initialPrice ?? asset.price),
      }
      if (asset.id) assetPayload.id = asset.id

      const { data: assetRow, error: assetError } = await supabase
        .from('assets')
        .upsert(assetPayload)
        .select('id')
        .single()
      throwIfImportAborted(signal)
      if (assetError) throw new Error(`Failed to upsert asset "${asset.name}": ${assetError.message}`)
      importedAssets += 1

      for (const subtype of asset.stockSubtypes) {
        throwIfImportAborted(signal)
        const subtypePayload: Record<string, unknown> = {
          asset_id: assetRow.id,
          subtype: subtype.subtype,
        }
        if (subtype.id) subtypePayload.id = subtype.id

        const { data: subtypeRow, error: subtypeError } = await supabase
          .from('stock_subtypes')
          .upsert(subtypePayload, { onConflict: subtype.id ? undefined : 'asset_id,subtype' })
          .select('id')
          .single()
        throwIfImportAborted(signal)
        if (subtypeError) {
          throw new Error(`Failed to upsert ${subtype.subtype} subtype for "${asset.name}": ${subtypeError.message}`)
        }
        importedSubtypes += 1

        for (const tx of subtype.transactions) {
          throwIfImportAborted(signal)
          const txPayload: Record<string, unknown> = {
            subtype_id: subtypeRow.id,
            count: tx.count,
            cost_price: tx.costPrice,
            purchase_date: tx.purchaseDate,
            capital_gains_status: tx.capitalGainsStatus,
          }
          if (tx.id) txPayload.id = tx.id
          const txResult = tx.id
            ? await supabase.from('transactions').upsert(txPayload)
            : await supabase.from('transactions').insert(txPayload)
          throwIfImportAborted(signal)
          if (txResult.error) {
            throw new Error(`Failed to import transaction for "${asset.name}": ${txResult.error.message}`)
          }
          importedTransactions += 1
        }

        for (const grant of subtype.rsuGrants) {
          throwIfImportAborted(signal)
          const grantPayload: Record<string, unknown> = {
            subtype_id: subtypeRow.id,
            grant_date: grant.grantDate,
            total_shares: grant.totalShares,
            vest_start: grant.vestStart,
            vest_end: grant.vestEnd,
            cliff_date: grant.cliffDate,
            ended_at: grant.endedAt,
          }
          if (grant.id) grantPayload.id = grant.id
          const grantResult = grant.id
            ? await supabase.from('rsu_grants').upsert(grantPayload)
            : await supabase.from('rsu_grants').insert(grantPayload)
          throwIfImportAborted(signal)
          if (grantResult.error) {
            throw new Error(`Failed to import RSU grant for "${asset.name}": ${grantResult.error.message}`)
          }
          importedRsuGrants += 1
        }
      }
    }

    for (const link of data.tickerThemes) {
      throwIfImportAborted(signal)
      const tickerId = link.tickerId
        ? tickerIdBySourceId.get(link.tickerId) ?? await ensureTicker({ sourceId: link.tickerId, symbol: link.tickerSymbol })
        : await ensureTicker({ symbol: link.tickerSymbol })
      const themeId = link.themeId
        ? themeIdBySourceId.get(link.themeId) ?? await ensureTheme(link.themeName, link.themeId)
        : await ensureTheme(link.themeName)
      if (!tickerId || !themeId) continue
      const { error } = await supabase.from('ticker_themes').upsert({ ticker_id: tickerId, theme_id: themeId })
      throwIfImportAborted(signal)
      if (error) throw new Error(`Failed to link ticker theme: ${error.message}`)
      importedTickerThemes += 1
    }

    throwIfImportAborted(signal)
    const { data: existingTargets, error: existingTargetsError } = await supabase
      .from('theme_targets')
      .select('id, theme_id')
      .eq('user_id', userId)
    throwIfImportAborted(signal)
    if (existingTargetsError) throw new Error(`Failed to read existing theme targets: ${existingTargetsError.message}`)
    const existingTargetByThemeId = new Map((existingTargets ?? []).map((row: any) => [row.theme_id as string, row.id as string]))

    for (const target of data.themeTargets) {
      throwIfImportAborted(signal)
      const themeId = target.themeId
        ? themeIdBySourceId.get(target.themeId) ?? await ensureTheme(target.themeName, target.themeId)
        : await ensureTheme(target.themeName)
      if (!themeId) continue
      const payload = {
        user_id: userId,
        theme_id: themeId,
        target_percentage: target.targetPercentage,
        is_active: target.isActive,
      }
      const existingId = existingTargetByThemeId.get(themeId)
      if (existingId) {
        const { error } = await supabase.from('theme_targets').update(payload).eq('id', existingId)
        throwIfImportAborted(signal)
        if (error) throw new Error(`Failed to update theme target: ${error.message}`)
      } else {
        const { data: inserted, error } = await supabase
          .from('theme_targets')
          .insert(payload)
          .select('id')
          .single()
        throwIfImportAborted(signal)
        if (error) throw new Error(`Failed to create theme target: ${error.message}`)
        existingTargetByThemeId.set(themeId, inserted.id)
      }
      importedThemeTargets += 1
    }

    const autoThemeAssignmentEnabled = await isAutoThemeAssignmentEnabled(userId)
    throwIfImportAborted(signal)
    if (autoThemeAssignmentEnabled) {
      for (const [tickerId, symbol] of tickerSymbolById.entries()) {
        throwIfImportAborted(signal)
        try {
          const result = await autoAssignThemesForTicker({
            userId,
            tickerId,
            symbol,
            skipIfAlreadyTagged: true,
          })
          throwIfImportAborted(signal)
          autoAssignedTickerThemes += result.assignedCount
        } catch (error) {
          console.warn(`Auto theme assignment failed during import for ${symbol}`, error)
        }
      }
    }

    showAppAlert(
      `Imported ${importedLocations} locations, ${importedAssets} assets, ${importedSubtypes} stock buckets, ${importedTransactions} transactions, ${importedRsuGrants} RSU grants, ${importedTickers} tickers, ${importedThemes} themes, ${importedTickerThemes} ticker-theme links, ${importedThemeTargets} theme targets, and ${autoAssignedTickerThemes} AI-assigned ticker-theme links.`,
      { variant: 'success', durationMs: 6000 },
    )
  } catch (error: any) {
    if (isImportAbortedError(error)) {
      console.warn('Import aborted')
      return
    }
    console.error('Import failed', error)
    showAppAlert(`Import failed: ${error?.message ?? 'Unknown error'}`, { variant: 'error', durationMs: 7000 })
  }
}
