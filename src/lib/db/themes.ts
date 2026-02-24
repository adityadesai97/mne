import { getSupabaseClient } from '../supabase'

export async function getAllThemes() {
  const { data, error } = await getSupabaseClient()
    .from('themes')
    .select('*, theme_targets(*)')
    .order('name')
  if (error) throw error
  return data
}

export async function getOrCreateTheme(name: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const trimmed = name.trim()
  // Check if theme already exists for this user
  const { data: existing } = await supabase
    .from('themes')
    .select('id')
    .eq('user_id', user.id)
    .eq('name', trimmed)
    .maybeSingle()
  if (existing) return existing.id
  // Create new theme
  const { data, error } = await supabase
    .from('themes')
    .insert({ user_id: user.id, name: trimmed })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function addTickerTheme(tickerId: string, themeId: string) {
  const { error } = await getSupabaseClient()
    .from('ticker_themes')
    .upsert({ ticker_id: tickerId, theme_id: themeId })
  if (error) throw error
}

export async function removeTickerTheme(tickerId: string, themeId: string) {
  const { error } = await getSupabaseClient()
    .from('ticker_themes')
    .delete()
    .eq('ticker_id', tickerId)
    .eq('theme_id', themeId)
  if (error) throw error
}
