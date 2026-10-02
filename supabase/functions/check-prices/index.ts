import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchCryptoQuotes, type CryptoQuote } from './coingecko.ts'

// Sub-dollar coins need more than 2 decimals to be readable.
const fmtPrice = (n: number) => n.toFixed(n > 0 && n < 1 ? 6 : 2)

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')
  const eligible = (settings ?? []).filter((userSettings: any) => userSettings.price_alerts_enabled !== false)

  const tickersByUser = new Map<string, any[]>()
  for (const userSettings of eligible) {
    const { data: tickers } = await supabase
      .from('tickers')
      .select('*')
      .eq('user_id', userSettings.user_id)
      .not('current_price', 'is', null)
    tickersByUser.set(userSettings.user_id, tickers ?? [])
  }

  // Crypto tickers are priced from CoinGecko, not Finnhub. CoinGecko's free
  // tier is call-count limited (not coin-count limited) and, keyless, limited
  // per IP — and every user's hourly call here comes from the same server IP.
  // So users with their own key get their own batched call, and *every other
  // user's coins are de-duplicated into one shared batch* (using the optional
  // project-wide COINGECKO_API_KEY secret when set), instead of one request
  // per user. Mirrors src/lib/coingecko.ts — edge functions can't import src/.
  const cryptoIdsFor = (userId: string): string[] => [...new Set(
    (tickersByUser.get(userId) ?? [])
      .filter((t: any) => t.kind === 'crypto' && t.coingecko_id)
      .map((t: any) => t.coingecko_id as string),
  )]
  const quotesByKeyedUser = new Map<string, Map<string, CryptoQuote>>()
  const sharedIds = new Set<string>()
  for (const userSettings of eligible) {
    const ids = cryptoIdsFor(userSettings.user_id)
    if (ids.length === 0) continue
    if (userSettings.coingecko_api_key) {
      quotesByKeyedUser.set(userSettings.user_id, await fetchCryptoQuotes(ids, userSettings.coingecko_api_key))
    } else {
      ids.forEach((id) => sharedIds.add(id))
    }
  }
  const sharedQuotes = sharedIds.size > 0
    ? await fetchCryptoQuotes([...sharedIds], Deno.env.get('COINGECKO_API_KEY') || undefined)
    : new Map<string, CryptoQuote>()

  for (const userSettings of eligible) {
    const tickers = tickersByUser.get(userSettings.user_id) ?? []
    const cryptoQuotes = quotesByKeyedUser.get(userSettings.user_id) ?? sharedQuotes

    for (const ticker of tickers) {
      let newPrice: number | undefined
      let previousClose: number | null = null
      if (ticker.kind === 'crypto') {
        const quote = ticker.coingecko_id ? cryptoQuotes.get(ticker.coingecko_id) : undefined
        if (!quote) continue
        newPrice = quote.price
        previousClose = quote.previousClose
      } else {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${ticker.symbol}&token=${userSettings.finnhub_api_key}`
        )
        const quote = await res.json()
        newPrice = quote.c
        if (Number.isFinite(Number(quote.pc))) previousClose = Number(quote.pc)
      }
      if (!newPrice) continue

      const oldPrice = Number(ticker.current_price)
      const changePct = Math.abs((newPrice - oldPrice) / oldPrice * 100)

      if (changePct >= Number(userSettings.price_alert_threshold)) {
        const direction = newPrice > oldPrice ? '▲' : '▼'
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({
            user_id: userSettings.user_id,
            title: `${ticker.symbol} moved ${direction}${changePct.toFixed(1)}%`,
            body: `$${fmtPrice(oldPrice)} → $${fmtPrice(newPrice)}`,
          }),
        })
      }

      const today = new Date().toISOString().split('T')[0]
      const update: Record<string, unknown> = { current_price: newPrice, last_updated: today }
      if (previousClose != null) update.previous_close = previousClose

      await supabase.from('tickers')
        .update(update)
        .eq('id', ticker.id)

      // Daily price-history snapshot — backs weekly/monthly/yearly/custom
      // timeframe stock and sector moves in the Portfolio Pulse carousel.
      // Same idempotent "overwrite today's row" upsert as the client path
      // (src/lib/db/tickerPriceHistory.ts) and net_worth_snapshots.
      await supabase.from('ticker_price_history')
        .upsert(
          { user_id: userSettings.user_id, ticker_id: ticker.id, date: today, price: newPrice },
          { onConflict: 'user_id,ticker_id,date' },
        )
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})
