import { getSupabaseClient } from '../supabase'

export async function getAllLocations() {
  const { data, error } = await getSupabaseClient().from('locations').select('*').order('name')
  if (error) throw error
  return data
}

export async function findOrCreateLocation(userId: string, name: string, accountType: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data: existing } = await supabase.from('locations')
    .select('id').eq('user_id', userId).eq('name', name).eq('account_type', accountType).maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase.from('locations')
    .insert({ user_id: userId, name, account_type: accountType }).select('id').single()
  if (error) throw new Error(`Failed to create location: ${error.message}`)
  return data.id
}
