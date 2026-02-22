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
  const { error } = await getSupabaseClient().from('assets').delete().eq('id', id)
  if (error) throw error
}
