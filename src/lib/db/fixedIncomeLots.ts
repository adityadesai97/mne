import { getSupabaseClient } from '../supabase'

export async function addFixedIncomeLot(assetId: string, lot: {
  count: number
  cost_price: number
  purchase_date: string
}) {
  const { data, error } = await getSupabaseClient()
    .from('fixed_income_lots')
    .insert({ asset_id: assetId, ...lot })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateFixedIncomeLot(id: string, updates: {
  count: number
  cost_price: number
  purchase_date: string
}) {
  const { error } = await getSupabaseClient()
    .from('fixed_income_lots')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function deleteFixedIncomeLot(id: string) {
  const { error } = await getSupabaseClient().from('fixed_income_lots').delete().eq('id', id)
  if (error) throw error
}
