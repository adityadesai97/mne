import { getSupabaseClient } from '../supabase'

export async function loadApiKeys(): Promise<{ claudeApiKey: string; finnhubApiKey: string } | null> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return null
  const { data } = await getSupabaseClient()
    .from('user_settings')
    .select('claude_api_key, finnhub_api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data?.claude_api_key || !data?.finnhub_api_key) return null
  return { claudeApiKey: data.claude_api_key, finnhubApiKey: data.finnhub_api_key }
}

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
    .upsert({ ...settings, user_id: user.id }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function syncFinnhubKey() {
  const { config } = await import('@/store/config')
  const key = config.finnhubApiKey
  if (!key) return
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return
  const { error } = await getSupabaseClient()
    .from('user_settings')
    .upsert({ user_id: user.id, finnhub_api_key: key }, { onConflict: 'user_id' })
  if (error) throw error
}
