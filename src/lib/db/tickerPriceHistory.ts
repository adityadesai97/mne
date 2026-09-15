import { getSupabaseClient } from '../supabase'

export interface TickerPricePoint {
  date: string
  price: number
}

// Upserts today's price row per ticker — same "overwrite today's row in
// place" shape as recordDailySnapshot. Called alongside every price
// refresh (refreshAllPrices here, check-prices' own Deno-side upsert on
// the edge function path) so history accumulates for free over time;
// there is no way to backfill days before this started recording.
export async function recordTickerPriceSnapshots(prices: { tickerId: string; price: number }[]): Promise<void> {
  if (prices.length === 0) return
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const today = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('ticker_price_history')
    .upsert(
      prices.map(p => ({ user_id: user.id, ticker_id: p.tickerId, date: today, price: p.price })),
      { onConflict: 'user_id,ticker_id,date' },
    )
  if (error) throw error
}

// One batched query for every ticker the caller cares about, rather than
// one round trip per ticker. Rows come back oldest-first per ticker so
// callers can find "closest row at least N days old" by scanning forward.
export async function getTickerPriceHistory(tickerIds: string[], sinceDate: string): Promise<Map<string, TickerPricePoint[]>> {
  const result = new Map<string, TickerPricePoint[]>()
  if (tickerIds.length === 0) return result

  const { data, error } = await getSupabaseClient()
    .from('ticker_price_history')
    .select('ticker_id, date, price')
    .in('ticker_id', tickerIds)
    .gte('date', sinceDate)
    .order('date', { ascending: true })
  if (error) throw error

  for (const row of data ?? []) {
    const list = result.get(row.ticker_id) ?? []
    list.push({ date: row.date, price: Number(row.price) })
    result.set(row.ticker_id, list)
  }
  return result
}
