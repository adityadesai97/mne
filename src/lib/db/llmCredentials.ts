import { getSupabaseClient } from '../supabase'
import { config } from '@/store/config'

// The Claude API key is write-only from the browser: it is saved to
// llm_credential_secrets (no select policy at all) and only the llm-proxy edge
// function ever reads it. llm_credentials.secret_set is the one readable flag
// that tells the client the key actually landed. Same shape as the Plaid
// credential tables; see savePlaidCredentials for why this is a plain
// update-then-insert and never an upsert (an upsert needs SELECT privilege,
// which this table deliberately lacks, and the resulting 403 would sign the
// user out).

export async function getLlmKeySet(): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from('llm_credentials')
    .select('secret_set')
    .maybeSingle()
  if (error) throw error
  return !!data?.secret_set
}

export async function saveLlmKey(apiKey: string): Promise<void> {
  const key = apiKey.trim()
  if (!key) throw new Error('Enter a Claude API key.')
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const now = new Date().toISOString()

  const { error: credError } = await getSupabaseClient()
    .from('llm_credentials')
    .upsert({ user_id: user.id, updated_at: now }, { onConflict: 'user_id' })
  if (credError) throw credError

  const { error: updateError, count } = await getSupabaseClient()
    .from('llm_credential_secrets')
    .update({ api_key: key, updated_at: now }, { count: 'exact' })
    .eq('user_id', user.id)
  if (updateError) throw updateError
  if (!count) {
    const { error: insertError } = await getSupabaseClient()
      .from('llm_credential_secrets')
      .insert({ user_id: user.id, api_key: key, updated_at: now })
    if (insertError) throw insertError
  }

  const { error: flagError } = await getSupabaseClient()
    .from('llm_credentials')
    .update({ secret_set: true })
    .eq('user_id', user.id)
  if (flagError) throw flagError

  config.save({ llmKeySet: true })
  config.clearLegacyClaudeApiKey()
}

/**
 * One-time move of a Claude key that predates the proxy: it used to live in
 * localStorage and in user_settings.claude_api_key (readable from the
 * browser). Saves it server-side, then clears both copies. Safe to call on
 * every startup; does nothing once there is no legacy copy left. On failure
 * (for example the migration is not applied yet) the legacy copies stay, so
 * nothing is lost.
 */
export async function migrateLegacyClaudeKey(): Promise<void> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return
  const { data: row } = await getSupabaseClient()
    .from('user_settings')
    .select('claude_api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  const dbKey = (row as { claude_api_key?: string | null } | null)?.claude_api_key ?? ''
  const legacy = config.legacyClaudeApiKey || dbKey
  if (!legacy) return

  if (!config.llmKeySet && !(await getLlmKeySet())) {
    await saveLlmKey(legacy)
  } else {
    config.save({ llmKeySet: true })
    config.clearLegacyClaudeApiKey()
  }
  if (dbKey) {
    await getSupabaseClient().from('user_settings').update({ claude_api_key: null }).eq('user_id', user.id)
  }
}
