import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Sub-dollar coins need more than 2 decimals to be readable.
const fmtPrice = (n: number) => n.toFixed(n > 0 && n < 1 ? 6 : 2)

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    if (userSettings.price_alerts_enabled === false) continue
    const { data: tickers } = await supabase
      .from('tickers')
      .select('*')
      .eq('user_id', userSettings.user_id)
      .not('current_price', 'is', null)

    // Crypto tickers are priced from CoinGecko in one batched call per user
    // (the free tier is call-count limited, not coin-count limited), stock
    // tickers from Finnhub one by one. Mirrors src/lib/coingecko.ts — edge
    // functions can't import from src/.
    const cryptoQuotes = new Map<string, { price: number; previousClose: number | null }>()
    const cryptoIds = [...new Set((tickers ?? [])
      .filter((t: any) => t.kind === 'crypto' && t.coingecko_id)
      .map((t: any) => t.coingecko_id as string))]
    if (cryptoIds.length > 0) {
      try {
        const params = new URLSearchParams({
          ids: cryptoIds.join(','),
          vs_currencies: 'usd',
          include_24hr_change: 'true',
        })
        if (userSettings.coingecko_api_key) params.set('x_cg_demo_api_key', userSettings.coingecko_api_key)
        const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params.toString()}`)
        if (cgRes.ok) {
          const body = await cgRes.json()
          for (const id of cryptoIds) {
            const price = Number(body?.[id]?.usd)
            if (!Number.isFinite(price) || price <= 0) continue
            const pct = Number(body[id].usd_24h_change)
            cryptoQuotes.set(id, {
              price,
              previousClose: Number.isFinite(pct) && pct > -100 ? price / (1 + pct / 100) : null,
            })
          }
        }
      } catch { /* best-effort — a failed CoinGecko call just skips crypto this run */ }
    }

    for (const ticker of tickers ?? []) {
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
