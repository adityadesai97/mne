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

export async function getSettings() {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function saveSettings(settings: Record<string, unknown>) {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await getSupabaseClient()
    .from('user_settings')
    .upsert({ ...settings, user_id: user.id })
  if (error) throw error
}
