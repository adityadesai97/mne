import { getSupabaseClient } from '../supabase'
import { config } from '@/store/config'

// The Claude API key is write-only from the browser: it is saved to
// llm_credential_secrets (no select policy at all) and only the llm-proxy edge
// function ever reads it. llm_credentials.secret_set is the one readable flag
// that tells the client the key actually landed. Writes go through the
// save_llm_key SQL function (security definer): an upsert needs SELECT (its
// 403 would sign the user out) and an update-then-insert fails too, because
// with no select policy the UPDATE sees no rows.

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
  // One server-side function writes the key and the flag together. A client
  // side "update, else insert" cannot work here: with no select policy, an
  // UPDATE ... WHERE user_id = ... matches no rows (RLS needs select access to
  // see them), so replacing an existing key fell through to an INSERT and hit
  // the primary key.
  const { error } = await getSupabaseClient().rpc('save_llm_key', { p_key: key })
  if (error) throw error
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
