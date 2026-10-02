// CoinGecko quote fetching for check-prices — a Deno port of the relevant part
// of src/lib/coingecko.ts (edge functions can't import from src/). Kept in its
// own dependency-free file so it can be unit tested under Vitest.

export interface CryptoQuote {
  price: number
  // Price 24h ago, implied by the rolling 24h % change — the crypto analogue of
  // a stock's previous_close (crypto has no market close).
  previousClose: number | null
}

const BASE_URL = 'https://api.coingecko.com/api/v3'
// Comfortably under URL-length limits; also keeps one bad id from sinking a
// huge batch.
export const COINGECKO_ID_CHUNK = 100
const RETRY_DELAY_MS = 2000
const MAX_RETRY_DELAY_MS = 5000

export function derivePreviousClose(price: number, changePct: unknown): number | null {
  const pct = Number(changePct)
  if (!Number.isFinite(price) || !Number.isFinite(pct) || pct <= -100) return null
  return price / (1 + pct / 100)
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Batched quote lookup: ids are de-duplicated and sent `COINGECKO_ID_CHUNK` at
 * a time, one request per chunk regardless of how many users hold the coins.
 * A 429 is retried once after a short wait (honoring a small Retry-After);
 * anything still failing is skipped so one rate-limited or bad chunk never
 * aborts the whole alert run — the affected coins simply keep their last
 * price this hour. Coins CoinGecko doesn't return are absent from the result.
 */
export async function fetchCryptoQuotes(
  ids: string[],
  apiKey?: string,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<Map<string, CryptoQuote>> {
  const sleep = options.sleep ?? defaultSleep
  const quotes = new Map<string, CryptoQuote>()
  const unique = [...new Set(ids.filter(Boolean))]

  for (let i = 0; i < unique.length; i += COINGECKO_ID_CHUNK) {
    const chunk = unique.slice(i, i + COINGECKO_ID_CHUNK)
    const params = new URLSearchParams({
      ids: chunk.join(','),
      vs_currencies: 'usd',
      include_24hr_change: 'true',
    })
    if (apiKey) params.set('x_cg_demo_api_key', apiKey)
    const url = `${BASE_URL}/simple/price?${params.toString()}`

    try {
      let res = await fetch(url)
      if (res.status === 429) {
        const retryAfter = Number(res.headers?.get?.('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : RETRY_DELAY_MS
        await sleep(wait)
        res = await fetch(url)
      }
      if (!res.ok) {
        console.warn(`CoinGecko price request failed (${res.status}) for ${chunk.length} coin(s)`)
        continue
      }
      const body = await res.json()
      for (const id of chunk) {
        const price = Number(body?.[id]?.usd)
        if (!Number.isFinite(price) || price <= 0) continue
        quotes.set(id, { price, previousClose: derivePreviousClose(price, body[id].usd_24h_change) })
      }
    } catch (error) {
      console.warn('CoinGecko price request errored', error)
    }
  }
  return quotes
}
