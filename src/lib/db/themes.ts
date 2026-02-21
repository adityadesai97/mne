import { getSupabaseClient } from '../supabase'

export async function getAllThemes() {
  const { data, error } = await getSupabaseClient()
    .from('themes')
    .select('*, theme_targets(*)')
    .order('name')
  if (error) throw error
  return data
}
