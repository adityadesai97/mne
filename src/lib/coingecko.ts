// CoinGecko client — prices, 24h change, coin search and daily history for
// crypto tickers (tickers.kind = 'crypto'). Finnhub's free tier has no usable
// crypto quote/candle endpoint, so crypto is priced here instead.
//
// Works keyless (public API, tight per-IP rate limit, called straight from the
// browser) or with a free Demo key, in which case calls go through the
// market-proxy edge function (see marketData.ts) so the key never reaches the
// browser.

import { coingeckoFetch } from './marketData'
import { config } from '@/store/config'

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

/** A failed CoinGecko request, with a message written for the end user —
 *  these surface verbatim in the command bar, the Watchlist add form, and
 *  toasts, and the common cause for an existing account (no key set, shared
 *  keyless rate limit exhausted) has a fix the message can name. */
export class CoinGeckoError extends Error {
  status: number
  rateLimited: boolean
  constructor(status: number, hasKey: boolean) {
    const rateLimited = status === 429
    let message: string
    if (rateLimited && !hasKey) {
      message = "CoinGecko's free keyless rate limit was hit. Add a free CoinGecko key in Settings → Update API keys (optional field), then try again."
    } else if (rateLimited) {
      message = 'CoinGecko rate limit hit — wait a minute and try again.'
    } else if ((status === 401 || status === 403) && hasKey) {
      message = 'CoinGecko rejected your API key — check it in Settings → Update API keys.'
    } else {
      message = `CoinGecko request failed (${status}).`
    }
    super(message)
    this.name = 'CoinGeckoError'
    this.status = status
    this.rateLimited = rateLimited
  }
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
export async function fetchCryptoQuotes(ids: string[]): Promise<Map<string, CryptoQuote>> {
  const result = new Map<string, CryptoQuote>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return result
  const res = await coingeckoFetch('simple/price', {
    ids: unique.join(','),
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  })
  if (!res.ok) throw new CoinGeckoError(res.status, config.coingeckoKeySet)
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

export async function searchCoinBySymbol(symbol: string): Promise<CoinSearchResult | null> {
  const res = await coingeckoFetch('search', { query: symbol.trim() })
  if (!res.ok) throw new CoinGeckoError(res.status, config.coingeckoKeySet)
  const body = await res.json()
  return pickCoinForSymbol(symbol, Array.isArray(body?.coins) ? body.coins : [])
}

/** Daily closes (UTC date → price) for up to the last year; used to backfill
 *  ticker_price_history so a new crypto holding's weekly/monthly/yearly
 *  Portfolio Pulse cards don't have to wait for history to accumulate. */
export async function fetchCoinDailyHistory(id: string, days = 365): Promise<{ date: string; price: number }[]> {
  const res = await coingeckoFetch(`coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: 'usd',
    days: String(days),
    interval: 'daily',
  })
  if (!res.ok) throw new CoinGeckoError(res.status, config.coingeckoKeySet)
  const body = await res.json()
  const byDate = new Map<string, number>()
  for (const point of Array.isArray(body?.prices) ? body.prices : []) {
    const [ts, price] = point as [number, number]
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) continue
    byDate.set(new Date(ts).toISOString().split('T')[0], price)
  }
  return [...byDate.entries()].map(([date, price]) => ({ date, price }))
}
