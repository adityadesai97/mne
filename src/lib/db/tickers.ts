import { getSupabaseClient } from '../supabase'

export async function getAllTickers() {
  const { data, error } = await getSupabaseClient()
    .from('tickers')
    .select('*, ticker_themes(theme:themes(*))')
    .order('symbol')
  if (error) throw error
  return data
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

export async function updateTickerPrice(symbol: string, price: number) {
  const { error } = await getSupabaseClient()
    .from('tickers')
    .update({ current_price: price, last_updated: new Date().toISOString().split('T')[0] })
    .eq('symbol', symbol)
  if (error) throw error
}
