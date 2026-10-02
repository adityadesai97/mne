import { getSupabaseClient } from '../supabase'
import { isTickerAsset } from '../portfolio'
import { getTickerPriceHistory } from './tickerPriceHistory'
import { estimateNetWorthOn, MAX_PRICE_STALENESS_DAYS } from '../snapshotBackfill'

// Fills in a snapshot for each stock/crypto purchase date that has none (the
// days the app wasn't opened). Each is estimated from the nearest earlier real
// snapshot plus the change in stock/crypto value since then, using each day's
// recorded prices — see estimateNetWorthOn. Dates before the earliest real
// snapshot have nothing to anchor on and are skipped, as is any date where a
// held ticker has no recorded price.
export async function backfillHistoricalSnapshots(assets: any[]) {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('net_worth_snapshots')
    .select('date, value')
    .eq('user_id', user.id)
    .order('date')
  const real = (existing ?? []).map((r: any) => ({ date: r.date as string, value: Number(r.value) }))
  if (real.length === 0) return
  const existingDates = new Set(real.map(r => r.date))
  const earliestReal = real[0].date

  // Candidate dates: purchase dates inside real history with no snapshot.
  const today = new Date().toISOString().split('T')[0]
  const candidates = new Set<string>()
  for (const asset of assets) {
    if (!isTickerAsset(asset)) continue
    for (const st of asset.stock_subtypes ?? []) {
      for (const t of st.transactions ?? []) {
        const d = t.purchase_date
        if (d && d < today && d > earliestReal && !existingDates.has(d)) candidates.add(d)
      }
    }
  }
  if (candidates.size === 0) return

  const tickerIds = [...new Set(assets.filter(isTickerAsset).map((a: any) => a.ticker?.id).filter(Boolean))] as string[]
  const sinceMs = Date.parse(earliestReal) - (MAX_PRICE_STALENESS_DAYS + 1) * 24 * 60 * 60 * 1000
  const priceHistory = await getTickerPriceHistory(tickerIds, new Date(sinceMs).toISOString().split('T')[0])

  const toInsert: { user_id: string; date: string; value: number }[] = []
  for (const date of [...candidates].sort()) {
    // Nearest earlier real snapshot (real[] is date-sorted).
    let anchor: { date: string; value: number } | undefined
    for (const r of real) { if (r.date < date) anchor = r; else break }
    const value = estimateNetWorthOn(date, anchor, assets, priceHistory)
    if (value != null) toInsert.push({ user_id: user.id, date, value })
  }

  if (toInsert.length > 0) {
    await supabase.from('net_worth_snapshots')
      .upsert(toInsert, { onConflict: 'user_id,date' })
  }
}

export async function recordDailySnapshot(value: number) {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const today = new Date().toISOString().split('T')[0]
  await supabase.from('net_worth_snapshots')
    .upsert({ user_id: user.id, date: today, value }, { onConflict: 'user_id,date' })
}

export async function getSnapshots() {
  const { data, error } = await getSupabaseClient()
    .from('net_worth_snapshots')
    .select('date, value')
    .order('date')
  if (error) throw error
  return data ?? []
}

// Bulk restore for the "All data" import path. Upserts on (user_id, date) —
// re-importing the same backup overwrites same-day values in place rather
// than creating duplicate rows.
export async function upsertSnapshots(userId: string, rows: { date: string; value: number }[]) {
  if (rows.length === 0) return
  const { error } = await getSupabaseClient()
    .from('net_worth_snapshots')
    .upsert(
      rows.map((r) => ({ user_id: userId, date: r.date, value: r.value })),
      { onConflict: 'user_id,date' },
    )
  if (error) throw error
}
