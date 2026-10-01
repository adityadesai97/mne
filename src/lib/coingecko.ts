// CoinGecko client — prices, 24h change, coin search and daily history for
// crypto tickers (tickers.kind = 'crypto'). Finnhub's free tier has no usable
// crypto quote/candle endpoint, so crypto is priced here instead.
//
// Works keyless (public API, tight per-IP rate limit) or with a free Demo key
// (config.coingeckoApiKey / user_settings.coingecko_api_key). The key goes in
// the query string rather than the x-cg-demo-api-key header so browser calls
// stay "simple" CORS requests with no preflight.

const BASE_URL = 'https://api.coingecko.com/api/v3'

export interface CryptoQuote {
  price: number
  // CoinGecko only exposes a rolling 24h % change, not a calendar-day close,
  // so this is the price 24h ago — the crypto analogue of a stock's
  // previous_close (crypto has no market close).
  previousClose: number | null
}

export interface CoinSearchResult {
  id: string
  name: string
  symbol: string
  logo: string | null
}

function buildUrl(path: string, params: Record<string, string>, apiKey?: string): string {
  const qs = new URLSearchParams(params)
  if (apiKey) qs.set('x_cg_demo_api_key', apiKey)
  return `${BASE_URL}${path}?${qs.toString()}`
}

/** Price 24h ago, implied by the current price and its 24h % change. */
export function derivePreviousClose(price: number, changePct: unknown): number | null {
  const pct = Number(changePct)
  if (!Number.isFinite(price) || !Number.isFinite(pct) || pct <= -100) return null
  return price / (1 + pct / 100)
}

/**
 * Batched quote lookup — one call regardless of how many coins, which is what
 * keeps crypto refreshes cheap against CoinGecko's per-minute and monthly
 * caps. Coins CoinGecko doesn't return (bad id, delisted) are simply absent
 * from the result.
 */
export async function fetchCryptoQuotes(ids: string[], apiKey?: string): Promise<Map<string, CryptoQuote>> {
  const result = new Map<string, CryptoQuote>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return result
  const res = await fetch(buildUrl('/simple/price', {
    ids: unique.join(','),
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  }, apiKey))
  if (!res.ok) throw new Error(`CoinGecko price request failed (${res.status})`)
  const body = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>
  for (const id of unique) {
    const entry = body?.[id]
    const price = Number(entry?.usd)
    if (!entry || !Number.isFinite(price) || price <= 0) continue
    result.set(id, { price, previousClose: derivePreviousClose(price, entry.usd_24h_change) })
  }
  return result
}

/**
 * Picks the coin a ticker symbol most likely means. Symbols collide across
 * coins (dozens of tokens call themselves "BTC"), so among exact symbol
 * matches the best market-cap rank wins; ranked coins beat unranked ones.
 */
export function pickCoinForSymbol(
  symbol: string,
  coins: { id?: string; name?: string; symbol?: string; market_cap_rank?: number | null; large?: string; thumb?: string }[],
): CoinSearchResult | null {
  const wanted = symbol.trim().toLowerCase()
  if (!wanted) return null
  const matches = coins.filter(c => c.id && c.symbol?.toLowerCase() === wanted)
  if (matches.length === 0) return null
  matches.sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))
  const best = matches[0]
  return {
    id: best.id as string,
    name: best.name ?? best.symbol ?? (best.id as string),
    symbol: (best.symbol ?? symbol).toUpperCase(),
    logo: best.large ?? best.thumb ?? null,
  }
}

export async function searchCoinBySymbol(symbol: string, apiKey?: string): Promise<CoinSearchResult | null> {
  const res = await fetch(buildUrl('/search', { query: symbol.trim() }, apiKey))
  if (!res.ok) throw new Error(`CoinGecko search failed (${res.status})`)
  const body = await res.json()
  return pickCoinForSymbol(symbol, Array.isArray(body?.coins) ? body.coins : [])
}

/** Daily closes (UTC date → price) for up to the last year; used to backfill
 *  ticker_price_history so a new crypto holding's weekly/monthly/yearly
 *  Portfolio Pulse cards don't have to wait for history to accumulate. */
export async function fetchCoinDailyHistory(id: string, days = 365, apiKey?: string): Promise<{ date: string; price: number }[]> {
  const res = await fetch(buildUrl(`/coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: 'usd',
    days: String(days),
    interval: 'daily',
  }, apiKey))
  if (!res.ok) throw new Error(`CoinGecko history request failed (${res.status})`)
  const body = await res.json()
  const byDate = new Map<string, number>()
  for (const point of Array.isArray(body?.prices) ? body.prices : []) {
    const [ts, price] = point as [number, number]
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue
    byDate.set(new Date(ts).toISOString().split('T')[0], price)
  }
  return [...byDate.entries()].map(([date, price]) => ({ date, price }))
}
