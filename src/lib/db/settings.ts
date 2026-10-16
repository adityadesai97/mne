import { getSupabaseClient } from '../supabase'
import type { TablesInsert } from '../database.types'
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
  // Keys live write-only on the server; only the "saved" flags are readable.
  const [llmSet, market] = await Promise.all([
    getLlmKeySet().catch(() => false),
    getMarketKeyStatus().catch(() => ({ finnhubSet: false, coingeckoSet: false })),
  ])
  const llmKeySet = llmSet
  const finnhubKeySet = market.finnhubSet
  if (!llmKeySet || !finnhubKeySet) return null
  return {
    llmKeySet,
    finnhubKeySet,
    coingeckoKeySet: market.coingeckoSet,
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

export async function upsertUserSettings(settings: TablesInsert<'user_settings'>) {
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
      .upsert(payload as TablesInsert<'user_settings'>, { onConflict: 'user_id' })
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
