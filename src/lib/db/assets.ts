import { getSupabaseClient } from '../supabase'

// plaid_synced_positions is nested in three places since it can point at an
// asset directly (flat-balance types), a transaction (stock tax lots), or a
// fixed_income_lot (Bond/T-Bill lots) — see src/lib/portfolio.ts's
// getPlaidSyncInfo() for how these are collapsed into one "is this asset
// Plaid-synced" answer.
const ASSET_SELECT = `
  *,
  location:locations(*),
  ticker:tickers(*, ticker_themes(theme:themes(*))),
  stock_subtypes(*, transactions(*, plaid_synced_positions(plaid_item:plaid_items(institution_name, last_synced_at))), rsu_grants(*)),
  fixed_income_lots(*, plaid_synced_positions(plaid_item:plaid_items(institution_name, last_synced_at))),
  plaid_synced_positions(plaid_item:plaid_items(institution_name, last_synced_at))
`

export async function getAllAssets() {
  const { data, error } = await getSupabaseClient()
    .from('assets')
    .select(ASSET_SELECT)
    .order('name')
  if (error) throw error
  return data
}

export async function upsertAsset(asset: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient()
    .from('assets')
    .upsert(asset)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAsset(id: string) {
  const supabase = getSupabaseClient()
  // Get subtype IDs first
  const { data: subtypes } = await supabase.from('stock_subtypes').select('id').eq('asset_id', id)
  if (subtypes?.length) {
    const subtypeIds = subtypes.map(s => s.id)
    await supabase.from('transactions').delete().in('subtype_id', subtypeIds)
    await supabase.from('rsu_grants').delete().in('subtype_id', subtypeIds)
    await supabase.from('stock_subtypes').delete().eq('asset_id', id)
  }
  await supabase.from('fixed_income_lots').delete().eq('asset_id', id)
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) throw error
}

export async function getAssetById(id: string) {
  const { data, error } = await getSupabaseClient()
    .from('assets')
    .select(ASSET_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}
