import { getSupabaseClient } from '../supabase'

// Backfill one snapshot per unique stock purchase_date using current prices × shares held on that date.
// Skips dates that already have a snapshot or are in the future.
export async function backfillHistoricalSnapshots(assets: any[]) {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('net_worth_snapshots')
    .select('date')
    .eq('user_id', user.id)
  const existingDates = new Set((existing ?? []).map((r: any) => r.date))

  // Collect all purchase dates across all stock transactions
  const allDates = new Set<string>()
  for (const asset of assets) {
    for (const st of asset.stock_subtypes ?? []) {
      for (const t of st.transactions ?? []) {
        if (t.purchase_date) allDates.add(t.purchase_date)
      }
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const toInsert: { user_id: string; date: string; value: number }[] = []

  for (const date of [...allDates].sort()) {
    if (date >= today || existingDates.has(date)) continue

    // Value on this date = sum of (shares in each stock purchased on or before this date) × current price
    let value = 0
    for (const asset of assets) {
      if (asset.asset_type !== 'Stock') continue
      const price = asset.ticker?.current_price
      if (!price) continue
      const shares = (asset.stock_subtypes ?? [])
        .flatMap((st: any) => st.transactions ?? [])
        .filter((t: any) => t.purchase_date <= date)
        .reduce((sum: number, t: any) => sum + Number(t.count), 0)
      value += price * shares
    }

    if (value > 0) toInsert.push({ user_id: user.id, date, value })
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
