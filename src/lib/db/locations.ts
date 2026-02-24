import { getSupabaseClient } from '../supabase'

export async function getAllLocations() {
  const { data, error } = await getSupabaseClient().from('locations').select('*').order('name')
  if (error) throw error
  return data
}

export async function findOrCreateLocation(userId: string, name: string, accountType: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data: existing, error: lookupError } = await supabase.from('locations')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .eq('account_type', accountType)
    .order('id', { ascending: true })
    .limit(1)
  if (lookupError) throw lookupError
  if (existing && existing.length > 0) return existing[0].id

  const { data, error } = await supabase.from('locations')
    .insert({ user_id: userId, name, account_type: accountType })
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`Failed to create location: ${error.message}`)
  if (!data) throw new Error('Failed to create location: no row returned')
  return data.id
}
