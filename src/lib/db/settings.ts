import { getSupabaseClient } from '../supabase'
import type { LLMProvider } from '@/store/config'

const VALID_PROVIDERS = ['claude', 'groq', 'gemini'] as const

function extractMissingColumn(error: { message?: string; details?: string; hint?: string } | null | undefined): string | null {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ')
  const match = text.match(/Could not find the '([^']+)' column/i)
  return match?.[1] ?? null
}

export async function loadApiKeys(): Promise<{
  claudeApiKey: string
  groqApiKey: string
  geminiApiKey: string
  llmProvider: LLMProvider
  finnhubApiKey: string
} | null> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return null
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') throw error
  if (!data?.finnhub_api_key) return null
  const hasAnyAIKey = data.claude_api_key || data.groq_api_key || data.gemini_api_key
  if (!hasAnyAIKey) return null
  return {
    claudeApiKey: data.claude_api_key ?? '',
    groqApiKey: data.groq_api_key ?? '',
    geminiApiKey: data.gemini_api_key ?? '',
    llmProvider: (VALID_PROVIDERS.includes(data.llm_provider as LLMProvider) ? data.llm_provider : 'claude') as LLMProvider,
    finnhubApiKey: data.finnhub_api_key,
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
