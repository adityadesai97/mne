import { getSupabaseClient } from './supabase'
import { config } from '@/store/config'

// Finnhub (and a keyed CoinGecko) requests go through the market-proxy edge
// function, which attaches the API key saved on the user's account. The
// browser never holds those keys. Callers get a normal fetch Response, so the
// existing `res.ok` / `res.json()` handling is unchanged.

async function proxyPost(provider: 'finnhub' | 'coingecko', path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base) throw new Error('Supabase is not configured.')
  const { data: { session } } = await getSupabaseClient().auth.getSession()
  if (!session) throw new Error('You are signed out. Sign in again to refresh prices.')
  return fetch(`${base}/functions/v1/market-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ provider, path, params }),
    signal,
  })
}

/** GET a Finnhub endpoint (path without a leading slash, e.g. 'quote', 'stock/profile2'). */
export function finnhubFetch(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  return proxyPost('finnhub', path, params, signal)
}

/**
 * GET a CoinGecko endpoint (path without a leading slash). With a key saved on
 * the account the call goes through the proxy; keyless it goes straight to
 * CoinGecko, since there is nothing to protect and the keyless rate limit is
 * per IP (every user sharing the server's IP would exhaust it).
 */
export function coingeckoFetch(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  if (config.coingeckoKeySet) return proxyPost('coingecko', path, params, signal)
  const qs = new URLSearchParams(params)
  return fetch(`https://api.coingecko.com/api/v3/${path}?${qs.toString()}`, { signal })
}
