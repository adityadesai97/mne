import { getSupabaseClient } from '../supabase'

export async function getUserSettings() {
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertUserSettings(settings: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .upsert(settings)
    .select()
    .single()
  if (error) throw error
  return data
}
