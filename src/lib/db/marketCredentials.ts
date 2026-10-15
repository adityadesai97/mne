import { getSupabaseClient } from '../supabase'
import { config } from '@/store/config'

// Finnhub and CoinGecko keys are write-only from the browser, exactly like the
// Claude key (see llmCredentials.ts): saved to market_credential_secrets (no
// select policy), flagged on market_credentials, used only by edge functions.
// Plain update-then-insert, never an upsert, for the same reason.

export async function getMarketKeyStatus(): Promise<{ finnhubSet: boolean; coingeckoSet: boolean }> {
  const { data, error } = await getSupabaseClient()
    .from('market_credentials')
    .select('finnhub_set, coingecko_set')
    .maybeSingle()
  if (error) throw error
  return { finnhubSet: !!data?.finnhub_set, coingeckoSet: !!data?.coingecko_set }
}

/** Saves whichever keys are given (blank values are left untouched). */
export async function saveMarketKeys(keys: { finnhubApiKey?: string; coingeckoApiKey?: string }): Promise<void> {
  const finnhub = keys.finnhubApiKey?.trim() ?? ''
  const coingecko = keys.coingeckoApiKey?.trim() ?? ''
  if (!finnhub && !coingecko) return
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const now = new Date().toISOString()

  const { error: credError } = await getSupabaseClient()
    .from('market_credentials')
    .upsert({ user_id: user.id, updated_at: now }, { onConflict: 'user_id' })
  if (credError) throw credError

  const secrets: Record<string, string> = {}
  if (finnhub) secrets.finnhub_api_key = finnhub
  if (coingecko) secrets.coingecko_api_key = coingecko
  const { error: updateError, count } = await getSupabaseClient()
    .from('market_credential_secrets')
    .update({ ...secrets, updated_at: now }, { count: 'exact' })
    .eq('user_id', user.id)
  if (updateError) throw updateError
  if (!count) {
    const { error: insertError } = await getSupabaseClient()
      .from('market_credential_secrets')
      .insert({ user_id: user.id, ...secrets, updated_at: now })
    if (insertError) throw insertError
  }

  const flags: Record<string, boolean> = {}
  if (finnhub) flags.finnhub_set = true
  if (coingecko) flags.coingecko_set = true
  const { error: flagError } = await getSupabaseClient()
    .from('market_credentials')
    .update(flags)
    .eq('user_id', user.id)
  if (flagError) throw flagError

  if (finnhub) { config.save({ finnhubKeySet: true }) }
  if (coingecko) { config.save({ coingeckoKeySet: true }) }
  config.clearLegacyMarketKeys()
}

/**
 * One-time move of Finnhub/CoinGecko keys that predate the proxy (kept in
 * localStorage and in user_settings, both readable from the browser) to the
 * server, then clears both old copies. Safe to call on every startup. On
 * failure the old copies stay, so nothing is lost.
 */
export async function migrateLegacyMarketKeys(): Promise<void> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return
  const { data: row } = await getSupabaseClient()
    .from('user_settings')
    .select('finnhub_api_key, coingecko_api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  const dbFinnhub = (row as { finnhub_api_key?: string | null } | null)?.finnhub_api_key ?? ''
  const dbCoingecko = (row as { coingecko_api_key?: string | null } | null)?.coingecko_api_key ?? ''
  const finnhub = config.legacyFinnhubApiKey || dbFinnhub
  const coingecko = config.legacyCoingeckoApiKey || dbCoingecko
  if (!finnhub && !coingecko) return

  const status = await getMarketKeyStatus().catch(() => ({ finnhubSet: false, coingeckoSet: false }))
  // Only send what the server does not already have; a key saved from
  // Settings on this device always wins over an old copy.
  await saveMarketKeys({
    finnhubApiKey: finnhub && !status.finnhubSet ? finnhub : '',
    coingeckoApiKey: coingecko && !status.coingeckoSet ? coingecko : '',
  })
  if (status.finnhubSet) config.save({ finnhubKeySet: true })
  if (status.coingeckoSet) config.save({ coingeckoKeySet: true })
  config.clearLegacyMarketKeys()
  if (dbFinnhub || dbCoingecko) {
    await getSupabaseClient().from('user_settings').update({ finnhub_api_key: null, coingecko_api_key: null }).eq('user_id', user.id)
  }
}
