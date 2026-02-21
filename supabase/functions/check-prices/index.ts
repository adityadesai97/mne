import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    const { data: tickers } = await supabase
      .from('tickers')
      .select('*')
      .eq('user_id', userSettings.user_id)
      .not('current_price', 'is', null)

    for (const ticker of tickers ?? []) {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker.symbol}&token=${userSettings.finnhub_api_key}`
      )
      const quote = await res.json()
      const newPrice = quote.c
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
            body: `$${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}`,
          }),
        })
      }

      await supabase.from('tickers')
        .update({ current_price: newPrice, last_updated: new Date().toISOString().split('T')[0] })
        .eq('id', ticker.id)
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})
