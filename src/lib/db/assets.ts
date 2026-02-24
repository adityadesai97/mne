import { getSupabaseClient } from '../supabase'

export async function getAllAssets() {
  const { data, error } = await getSupabaseClient()
    .from('assets')
    .select(`
      *,
      location:locations(*),
      ticker:tickers(*),
      stock_subtypes(*, transactions(*), rsu_grants(*))
    `)
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
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) throw error
}

export async function getAssetById(id: string) {
  const { data, error } = await getSupabaseClient()
    .from('assets')
    .select(`
      *,
      location:locations(*),
      ticker:tickers(*),
      stock_subtypes(*, transactions(*), rsu_grants(*))
    `)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}
