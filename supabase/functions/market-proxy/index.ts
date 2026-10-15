// Relays Finnhub and (for users who saved a CoinGecko key) CoinGecko requests
// for the signed-in user, so those API keys never reach the browser. The key
// is read with the service role from market_credential_secrets, which no
// client can select. Only the exact endpoints mne uses are allowed.
//
// Keyless CoinGecko users do NOT go through here: there is no key to protect,
// and CoinGecko's keyless limit is per IP, so funnelling every user through
// one server IP would make it worse.
//
// Deployed with verify_jwt:false like the plaid-* functions (the gateway's JWT
// check on CORS preflight breaks browser calls), so auth is checked manually.
// The policy helpers are exported and the remote import is lazy so
// src/__tests__/marketProxyPolicy.test.ts can run them in node.

// Not `declare const Deno`: that would clash with Deno's own global type when
// the function is type-checked by the Deno runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D = (globalThis as any).Deno

export const RATE_LIMIT_PER_MINUTE = 600
export const FINNHUB_PATHS = new Set([
  'quote',
  'stock/profile2',
  'stock/metric',
  'stock/recommendation',
  'stock/financials-reported',
  'company-news',
  'news',
  'calendar/earnings',
])
const COINGECKO_STATIC_PATHS = new Set(['simple/price', 'search'])
const COINGECKO_CHART = /^coins\/[a-z0-9-]{1,100}\/market_chart$/

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

type Provider = 'finnhub' | 'coingecko'

/** Returns an error message when the request is not something mne would send, else null. */
export function validateMarketRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.'
  const { provider, path, params } = body as Record<string, unknown>
  if (provider !== 'finnhub' && provider !== 'coingecko') return 'Unknown provider.'
  if (typeof path !== 'string') return 'path is required.'
  const allowed = provider === 'finnhub'
    ? FINNHUB_PATHS.has(path)
    : COINGECKO_STATIC_PATHS.has(path) || COINGECKO_CHART.test(path)
  if (!allowed) return 'That endpoint is not allowed.'
  if (params !== undefined) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return 'params must be an object.'
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (!/^[a-z_]{1,40}$/i.test(key)) return `Parameter "${key}" is not allowed.`
      if (/^(token|x_cg_demo_api_key|x-cg-demo-api-key)$/i.test(key)) return `Parameter "${key}" is not allowed.`
      if (typeof value !== 'string' || value.length > 1000) return `Parameter "${key}" must be a short string.`
    }
  }
  return null
}

/** Builds the upstream URL with the user's key attached. */
export function buildUpstreamUrl(provider: Provider, path: string, params: Record<string, string>, apiKey: string): string {
  const qs = new URLSearchParams(params)
  if (provider === 'finnhub') {
    qs.set('token', apiKey)
    return `https://finnhub.io/api/v1/${path}?${qs.toString()}`
  }
  qs.set('x_cg_demo_api_key', apiKey)
  return `https://api.coingecko.com/api/v3/${path}?${qs.toString()}`
}

export function bearerToken(header: string | null): string {
  return (header ?? '').replace(/^Bearer\s+/i, '').trim()
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // Remote URL import, resolved by the Deno runtime only (tsc can't see it).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const userClient = createClient(
    D.env.get('SUPABASE_URL')!,
    D.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  )
  const { data: { user } } = await userClient.auth.getUser(bearerToken(req.headers.get('Authorization')))
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401)

  let body: any
  try { body = await req.json() } catch { return jsonResponse({ error: 'Request body is not valid JSON.' }, 400) }
  const invalid = validateMarketRequest(body)
  if (invalid) return jsonResponse({ error: invalid }, 400)

  const admin = createClient(D.env.get('SUPABASE_URL')!, D.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('api_proxy_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('kind', 'market')
    .gte('called_at', since)
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    return new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and try again.' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '30' },
    })
  }
  await admin.from('api_proxy_calls').insert({ user_id: user.id, kind: 'market' })
  await admin.from('api_proxy_calls').delete().eq('user_id', user.id).eq('kind', 'market').lt('called_at', new Date(Date.now() - 86_400_000).toISOString())

  const { data: secrets } = await admin
    .from('market_credential_secrets')
    .select('finnhub_api_key, coingecko_api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  const provider = body.provider as Provider
  const apiKey = provider === 'finnhub' ? secrets?.finnhub_api_key : secrets?.coingecko_api_key
  if (!apiKey) {
    return jsonResponse({ error: `No ${provider === 'finnhub' ? 'Finnhub' : 'CoinGecko'} API key is saved for your account. Add one in Settings.` }, 409)
  }

  const upstream = await fetch(buildUpstreamUrl(provider, body.path, body.params ?? {}, apiKey as string))
  const responseHeaders = new Headers(CORS_HEADERS)
  responseHeaders.set('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

if (D?.serve) D.serve(handle)
