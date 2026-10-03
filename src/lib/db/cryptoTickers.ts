import { getSupabaseClient } from '../supabase'
import { config } from '@/store/config'
import { fetchCoinDailyHistory, fetchCryptoQuotes, searchCoinBySymbol } from '../coingecko'
import { backfillTickerPriceHistory } from './tickerPriceHistory'
import { addTickerTheme, getOrCreateTheme } from './themes'

// A database that predates the crypto migration has no tickers.kind /
// coingecko_id columns; PostgREST's "column not found" text means nothing to
// a user, so name the actual fix instead.
function missingMigrationError() {
  return new Error('Crypto support needs a one-time database update (migration 20260921000000_add_crypto_asset_type). Run the upgrade script, or apply that migration, then try again.')
}

/**
 * Finds or creates the crypto ticker for a symbol (e.g. 'BTC'), resolving the
 * CoinGecko coin id on first sight, then fetches its logo, an initial quote,
 * and a year of daily history (best effort — the ticker is usable without
 * any of them and the next refresh fills in the price).
 *
 * Throws if the symbol can't be resolved to a coin: unlike a stock ticker,
 * a crypto ticker with no coingecko_id could never be priced.
 */
export async function ensureCryptoTicker(
  userId: string,
  rawSymbol: string,
  options: { watchlistOnly?: boolean } = {},
): Promise<{ id: string; isNew: boolean }> {
  const supabase = getSupabaseClient()
  const symbol = rawSymbol.trim().toUpperCase()

  const { data: existing, error: lookupError } = await supabase.from('tickers')
    .select('id, kind, coingecko_id').eq('user_id', userId).eq('symbol', symbol).maybeSingle()
  if (lookupError && /kind|coingecko_id/i.test(lookupError.message ?? '')) throw missingMigrationError()
  if (existing?.kind === 'crypto' && existing.coingecko_id) return { id: existing.id, isNew: false }
  if (existing && existing.kind !== 'crypto') {
    throw new Error(`${symbol} is already tracked as a stock ticker, so it can't also be a crypto asset.`)
  }

  const apiKey = config.coingeckoApiKey || undefined
  const coin = await searchCoinBySymbol(symbol, apiKey)
  if (!coin) throw new Error(`Couldn't find a cryptocurrency with symbol ${symbol} on CoinGecko.`)

  const fields: Record<string, unknown> = {
    kind: 'crypto',
    coingecko_id: coin.id,
    logo: coin.logo,
  }
  let tickerId: string
  if (existing) {
    const { error } = await supabase.from('tickers').update(fields).eq('id', existing.id)
    if (error && /kind|coingecko_id/i.test(error.message ?? '')) throw missingMigrationError()
    if (error) throw new Error(`Failed to update ticker: ${error.message}`)
    tickerId = existing.id
  } else {
    const { data, error } = await supabase.from('tickers')
      .insert({ user_id: userId, symbol, watchlist_only: options.watchlistOnly ?? false, ...fields })
      .select('id').single()
    if (error && /kind|coingecko_id/i.test(error.message ?? '')) throw missingMigrationError()
    if (error) throw new Error(`Failed to create ticker: ${error.message}`)
    tickerId = data.id
  }

  try {
    const quotes = await fetchCryptoQuotes([coin.id], apiKey)
    const quote = quotes.get(coin.id)
    if (quote) {
      await supabase.from('tickers').update({
        current_price: quote.price,
        ...(quote.previousClose != null ? { previous_close: quote.previousClose } : {}),
        last_updated: new Date().toISOString().split('T')[0],
      }).eq('id', tickerId)
    }
  } catch { /* best-effort — next price refresh fills it in */ }

  try {
    await backfillTickerPriceHistory(tickerId, await fetchCoinDailyHistory(coin.id, 365, apiKey))
  } catch { /* best-effort — history just accumulates from today instead */ }

  try {
    // Finnhub's sector profile doesn't exist for coins, so auto theme
    // assignment has nothing to go on — a fixed "Crypto" theme keeps them
    // grouped (and lets Portfolio Pulse detect a crypto-wide sector move).
    await addTickerTheme(tickerId, await getOrCreateTheme('Crypto'))
  } catch { /* best-effort — a missing theme tag is cosmetic */ }

  return { id: tickerId, isNew: true }
}
