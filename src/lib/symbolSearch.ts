// Typeahead search for the Watchlist "Add a ticker" field. Stocks/ETFs come
// from Finnhub's `search` endpoint (via market-proxy), coins from CoinGecko's
// `search`. Pure normalisation + ranking so it can be unit tested with a
// mocked fetch.

import { finnhubFetch, coingeckoFetch } from './marketData'
import { CoinGeckoError } from './coingecko'
import { config } from '@/store/config'

export const MAX_SUGGESTIONS = 8

export interface SymbolSuggestion {
  symbol: string
  name: string
  kind: 'stock' | 'crypto'
  /** Small chip text: 'Stock', 'ETF', 'ADR', 'REIT', 'Fund' or, for coins, '#rank'. */
  label: string
  /** CoinGecko id (crypto only) so the exact coin can be added. */
  coinId?: string
  /** Coin image (crypto only). */
  logo?: string | null
  rank?: number | null
}

/** A stock search that failed; `status` lets the UI choose a quiet message. */
export class StockSearchError extends Error {
  status: number
  constructor(status: number, message?: string) {
    super(message ?? `Symbol search failed (${status}).`)
    this.name = 'StockSearchError'
    this.status = status
  }
}

// Finnhub instrument types worth adding to a watchlist, with the chip label.
const STOCK_TYPE_LABELS: Record<string, string> = {
  'common stock': 'Stock',
  etp: 'ETF',
  etf: 'ETF',
  adr: 'ADR',
  gdr: 'GDR',
  reit: 'REIT',
  'closed-end fund': 'Fund',
}

/** Foreign listings carry an exchange suffix (AAPL.SW, 0700.HK) that the free
 *  quote endpoint can't price; a single-letter suffix is a US share class (BRK.B). */
function isQuotableSymbol(symbol: string): boolean {
  if (!/^[A-Z0-9.\-^]{1,20}$/.test(symbol)) return false
  const dot = symbol.indexOf('.')
  if (dot === -1) return true
  return /^[A-Z]$/.test(symbol.slice(dot + 1))
}

function rankKey(symbol: string, q: string): number {
  const s = symbol.toUpperCase()
  const w = q.trim().toUpperCase()
  if (s === w) return 0
  if (s.startsWith(w)) return 1
  return 2
}

/** Exact symbol match first, then symbol prefix, then the rest; stable within a tier. */
export function rankSuggestions<T extends { symbol: string }>(items: T[], q: string): T[] {
  return items
    .map((item, i) => ({ item, i, k: rankKey(item.symbol, q) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(x => x.item)
}

export function normalizeStockResults(body: unknown, q: string): SymbolSuggestion[] {
  const raw = (body as { result?: unknown } | null)?.result
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SymbolSuggestion[] = []
  for (const r of raw as { description?: string; displaySymbol?: string; symbol?: string; type?: string }[]) {
    const symbol = String(r?.symbol ?? r?.displaySymbol ?? '').trim().toUpperCase()
    const label = STOCK_TYPE_LABELS[String(r?.type ?? '').trim().toLowerCase()]
    if (!symbol || !label || !isQuotableSymbol(symbol) || seen.has(symbol)) continue
    seen.add(symbol)
    out.push({ symbol, name: titleCaseName(String(r?.description ?? '')), kind: 'stock', label })
  }
  return rankSuggestions(out, q).slice(0, MAX_SUGGESTIONS)
}

// Finnhub descriptions are upper case ("APPLE INC"); make them readable.
function titleCaseName(name: string): string {
  const n = name.trim()
  if (n !== n.toUpperCase()) return n
  return n.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => (b.length <= 1 && /^(i|ii|iii)$/.test(a + b) ? (a + b).toUpperCase() : a.toUpperCase() + b))
    .replace(/\b(Inc|Corp|Co|Ltd|Plc|Etf|Adr|Llc)\b/g, m => (m === 'Etf' || m === 'Adr' || m === 'Llc' ? m.toUpperCase() : m))
}

export function normalizeCryptoResults(body: unknown, q: string): SymbolSuggestion[] {
  const raw = (body as { coins?: unknown } | null)?.coins
  if (!Array.isArray(raw)) return []
  const want = q.trim().toUpperCase()
  const seen = new Set<string>()
  const coins: SymbolSuggestion[] = []
  for (const c of raw as { id?: string; name?: string; symbol?: string; market_cap_rank?: number | null; large?: string; thumb?: string }[]) {
    if (!c?.id || !c.symbol || seen.has(c.id)) continue
    seen.add(c.id)
    const rank = typeof c.market_cap_rank === 'number' ? c.market_cap_rank : null
    coins.push({
      symbol: c.symbol.toUpperCase(),
      name: c.name ?? c.symbol,
      kind: 'crypto',
      label: rank != null ? `#${rank}` : 'Crypto',
      coinId: c.id,
      logo: c.large ?? c.thumb ?? null,
      rank,
    })
  }
  // Exact symbol match first, then market-cap rank (ranked beats unranked).
  coins.sort((a, b) => {
    const ea = a.symbol === want ? 0 : 1
    const eb = b.symbol === want ? 0 : 1
    return ea - eb || (a.rank ?? Infinity) - (b.rank ?? Infinity)
  })
  return coins.slice(0, MAX_SUGGESTIONS)
}

export async function searchStocks(q: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
  const query = q.trim()
  if (!query) return []
  const res = await finnhubFetch('search', { q: query }, signal)
  if (!res.ok) throw new StockSearchError(res.status)
  return normalizeStockResults(await res.json(), query)
}

export async function searchCrypto(q: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
  const query = q.trim()
  if (!query) return []
  const res = await coingeckoFetch('search', { query }, signal)
  if (!res.ok) throw new CoinGeckoError(res.status, config.coingeckoKeySet)
  return normalizeCryptoResults(await res.json(), query)
}

/** User-facing text for a failed search; never blocks manual entry. */
export function searchErrorMessage(err: unknown): string {
  if (err instanceof CoinGeckoError) return err.message
  return 'Suggestions are unavailable right now. You can still type a symbol and press Add.'
}
