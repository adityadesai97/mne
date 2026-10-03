import { getSupabaseClient } from '../supabase'
import { recordTickerPriceSnapshots } from './tickerPriceHistory'
import { CoinGeckoError, fetchCryptoQuotes } from '../coingecko'
import { showAppAlert } from '../appAlerts'
import { config } from '@/store/config'

export async function getAllTickers() {
  const { data, error } = await getSupabaseClient()
    .from('tickers')
    .select('*, ticker_themes(theme:themes(*))')
    .order('symbol')
  if (error) throw error
  return data
}

export async function deleteTicker(id: string) {
  const supabase = getSupabaseClient()

  const { count, error: countError } = await supabase
    .from('assets')
    .select('id', { count: 'exact', head: true })
    .eq('ticker_id', id)
    .in('asset_type', ['Stock', 'Crypto'])
  if (countError) throw countError
  if ((count ?? 0) > 0) {
    throw new Error('Cannot delete an owned ticker')
  }

  const { error: themeError } = await supabase.from('ticker_themes').delete().eq('ticker_id', id)
  if (themeError) throw themeError

  const { error } = await supabase.from('tickers').delete().eq('id', id)
  if (error) throw error
}

export async function upsertTicker(ticker: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient()
    .from('tickers')
    .upsert(ticker)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTickerPrice(symbol: string, price: number, previousClose?: number | null) {
  const update: Record<string, unknown> = { current_price: price, last_updated: new Date().toISOString().split('T')[0] }
  if (previousClose != null) update.previous_close = previousClose
  const { error } = await getSupabaseClient()
    .from('tickers')
    .update(update)
    .eq('symbol', symbol)
  if (error) throw error
}

// One toast per page load, not one per refresh (pull-to-refresh, pages that
// each call this) — resets on a real reload like priceRefresh's promise.
let warnedCryptoRateLimit = false

export async function refreshAllPrices(finnhubApiKey: string): Promise<void> {
  const tickers = await getAllTickers()
  const allTickers = (tickers ?? []).filter((t: any) => t.symbol)
  const stockTickers = allTickers.filter((t: any) => t.kind !== 'crypto')
  const cryptoTickers = allTickers.filter((t: any) => t.kind === 'crypto' && t.coingecko_id)
  const pricePoints: { tickerId: string; price: number }[] = []
  await Promise.all(stockTickers.map(async (ticker: any) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker.symbol}&token=${finnhubApiKey}`)
      const quote = await res.json()
      if (quote.c && Number.isFinite(Number(quote.c))) {
        const previousClose = Number.isFinite(Number(quote.pc)) ? Number(quote.pc) : null
        await updateTickerPrice(ticker.symbol, Number(quote.c), previousClose)
        pricePoints.push({ tickerId: ticker.id, price: Number(quote.c) })
      }
    } catch { /* best-effort per ticker */ }
  }))
  if (cryptoTickers.length > 0) {
    try {
      // One batched CoinGecko call for every coin, however many are held.
      const quotes = await fetchCryptoQuotes(cryptoTickers.map((t: any) => t.coingecko_id), config.coingeckoApiKey || undefined)
      await Promise.all(cryptoTickers.map(async (ticker: any) => {
        const quote = quotes.get(ticker.coingecko_id)
        if (!quote) return
        try {
          await updateTickerPrice(ticker.symbol, quote.price, quote.previousClose)
          pricePoints.push({ tickerId: ticker.id, price: quote.price })
        } catch { /* best-effort per ticker */ }
      }))
    } catch (error) {
      // Best-effort — a failed/rate-limited CoinGecko call keeps last prices.
      // But an existing account that never set a CoinGecko key would
      // otherwise just see crypto prices silently go stale, so say so once
      // per page load when the cause is the keyless rate limit.
      if (error instanceof CoinGeckoError && error.rateLimited && !config.coingeckoApiKey && !warnedCryptoRateLimit) {
        warnedCryptoRateLimit = true
        showAppAlert('Crypto prices couldn\'t refresh (CoinGecko keyless rate limit). Add a free CoinGecko key in Settings to fix this.', { variant: 'error', durationMs: 6000 })
      }
    }
  }
  try {
    await recordTickerPriceSnapshots(pricePoints)
  } catch { /* best-effort — a missed daily snapshot just delays that ticker's history */ }
}
