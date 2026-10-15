import { getSupabaseClient } from '../supabase'
import { getLlmKeySet } from './llmCredentials'
import { getMarketKeyStatus } from './marketCredentials'

function extractMissingColumn(error: { message?: string; details?: string; hint?: string } | null | undefined): string | null {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ')
  const match = text.match(/Could not find the '([^']+)' column/i)
  return match?.[1] ?? null
}

export async function loadApiKeys(): Promise<{
  llmKeySet: boolean
  finnhubKeySet: boolean
  coingeckoKeySet: boolean
} | null> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return null
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  // Keys now live write-only on the server (flags only are readable). A key
  // saved before the proxies existed still sits in user_settings until the
  // migrate* helpers move it, so those columns count as "has a key" here.
  const [llmSet, market] = await Promise.all([
    getLlmKeySet().catch(() => false),
    getMarketKeyStatus().catch(() => ({ finnhubSet: false, coingeckoSet: false })),
  ])
  const llmKeySet = llmSet || !!data?.claude_api_key
  const finnhubKeySet = market.finnhubSet || !!data?.finnhub_api_key
  if (!llmKeySet || !finnhubKeySet) return null
  return {
    llmKeySet,
    finnhubKeySet,
    coingeckoKeySet: market.coingeckoSet || !!data?.coingecko_api_key,
  }
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

  const payload: Record<string, unknown> = { ...settings, user_id: user.id }
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await getSupabaseClient()
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
    if (!error) return
    const missingColumn = extractMissingColumn(error)
    if (missingColumn && missingColumn !== 'user_id' && missingColumn in payload) {
      delete payload[missingColumn]
      continue
    }
    throw error
  }

  throw new Error('Failed to save settings after schema compatibility retries')
}
