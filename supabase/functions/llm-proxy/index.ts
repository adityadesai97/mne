// Relays Anthropic Messages API calls for the signed-in user so the Claude API
// key never reaches the browser. The browser points the Anthropic SDK's
// baseURL at this function; this swaps in the user's stored key (read with the
// service role from llm_credential_secrets, which no client can select) and
// streams Anthropic's reply straight back.
//
// Deployed with verify_jwt:false like the plaid-* functions: the gateway's JWT
// check on CORS preflight breaks browser calls, so auth is checked manually
// below. See plaid-create-link-token/index.ts for the full explanation.
//
// The policy helpers (validateLlmRequest, etc.) are exported and the remote
// import is lazy so src/__tests__/llmProxyPolicy.test.ts can run them in node.

// Not `declare const Deno`: that would clash with Deno's own global type when
// the function is type-checked by the Deno runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D = (globalThis as any).Deno

export const ALLOWED_MODELS = ['claude-sonnet-5']
export const MAX_OUTPUT_TOKENS = 16000
export const MAX_BODY_BYTES = 12 * 1024 * 1024
export const RATE_LIMIT_PER_MINUTE = 60
const ALLOWED_FIELDS = new Set(['model', 'max_tokens', 'temperature', 'system', 'messages', 'tools', 'output_config', 'stream'])
const ALLOWED_SERVER_TOOLS = new Set(['web_search_20250305'])

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, anthropic-version, anthropic-beta, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Anthropic-shaped error body, so the SDK surfaces `message` as-is. */
export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ type: 'error', error: { type: status === 429 ? 'rate_limit_error' : 'invalid_request_error', message } }, status)
}

/** Returns an error message when the request body is not something mne would send, else null. */
export function validateLlmRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.'
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) {
    if (!ALLOWED_FIELDS.has(key)) return `Field "${key}" is not allowed.`
  }
  if (typeof b.model !== 'string' || !ALLOWED_MODELS.includes(b.model)) return 'That model is not allowed.'
  if (typeof b.max_tokens !== 'number' || !Number.isFinite(b.max_tokens) || b.max_tokens < 1 || b.max_tokens > MAX_OUTPUT_TOKENS) {
    return `max_tokens must be between 1 and ${MAX_OUTPUT_TOKENS}.`
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) return 'messages must be a non-empty array.'
  if (b.tools !== undefined) {
    if (!Array.isArray(b.tools)) return 'tools must be an array.'
    for (const tool of b.tools as Array<Record<string, unknown>>) {
      const type = tool?.type
      if (type !== undefined && type !== 'custom' && !(typeof type === 'string' && ALLOWED_SERVER_TOOLS.has(type))) {
        return 'That tool type is not allowed.'
      }
    }
  }
  return null
}

/** Pulls the bearer token out of an Authorization header. */
export function bearerToken(header: string | null): string {
  return (header ?? '').replace(/^Bearer\s+/i, '').trim()
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    // The Anthropic SDK sends a changing set of x-stainless-* and
    // anthropic-* headers, so echo whatever the browser says it will send
    // instead of maintaining a list.
    const requested = req.headers.get('Access-Control-Request-Headers')
    return new Response('ok', { headers: { ...CORS_HEADERS, ...(requested ? { 'Access-Control-Allow-Headers': requested } : {}) } })
  }
  if (req.method !== 'POST') return errorResponse(405, 'Method not allowed')

  const path = new URL(req.url).pathname
  if (!path.endsWith('/v1/messages')) return errorResponse(404, 'Not found')

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
  if (!user) return errorResponse(401, 'Not authenticated')

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return errorResponse(413, 'Request is too large.')
  let body: unknown
  try { body = JSON.parse(raw) } catch { return errorResponse(400, 'Request body is not valid JSON.') }
  const invalid = validateLlmRequest(body)
  if (invalid) return errorResponse(400, invalid)

  const admin = createClient(D.env.get('SUPABASE_URL')!, D.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const since = new Date(Date.now() - 60_000).toISOString()
  const { count } = await admin
    .from('api_proxy_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('kind', 'llm')
    .gte('called_at', since)
  if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests. Wait a minute and try again.' } }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '30' },
    })
  }
  await admin.from('api_proxy_calls').insert({ user_id: user.id, kind: 'llm' })
  // Keep the log small: drop this user's rows older than a day.
  await admin.from('api_proxy_calls').delete().eq('user_id', user.id).eq('kind', 'llm').lt('called_at', new Date(Date.now() - 86_400_000).toISOString())

  const { data: secret } = await admin
    .from('llm_credential_secrets')
    .select('api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!secret?.api_key) {
    return errorResponse(409, 'No Claude API key is saved for your account. Add one in Settings.')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': secret.api_key as string,
    'anthropic-version': req.headers.get('anthropic-version') ?? '2023-06-01',
  }
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers['anthropic-beta'] = beta

  const upstream = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: raw })
  const responseHeaders = new Headers(CORS_HEADERS)
  const contentType = upstream.headers.get('content-type')
  if (contentType) responseHeaders.set('Content-Type', contentType)
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

if (D?.serve) D.serve(handle)
