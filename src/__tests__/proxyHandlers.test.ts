import { test, expect, vi, beforeEach, afterEach } from 'vitest'

// Runs the two edge functions' request handlers in node with a fake Supabase
// client and a fake upstream, to check the parts a policy test can't: auth,
// rate limiting, the key swap, and that the reply is relayed untouched.

let user: { id: string } | null = { id: 'u1' }
let callCount = 0
let secretRow: Record<string, string> | null = null
const inserts: any[] = []

function chain(table: string) {
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    lt: () => q,
    insert: (row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }) },
    delete: () => q,
    maybeSingle: () => Promise.resolve({ data: secretRow }),
    then: (res: any) => Promise.resolve({ count: callCount, error: null }).then(res),
  }
  return q
}

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({
  createClient: (_url: string, key: string) => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => chain(t),
    _key: key,
  }),
}))

const upstream = vi.fn()

beforeEach(() => {
  user = { id: 'u1' }
  callCount = 0
  secretRow = null
  inserts.length = 0
  upstream.mockReset()
  ;(globalThis as any).Deno = { env: { get: (k: string) => `env-${k}` } }
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as any).Deno })

const llmBody = { model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }
function llmReq(body: unknown = llmBody, headers: Record<string, string> = {}) {
  return new Request('https://abc.supabase.co/functions/v1/llm-proxy/v1/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json', 'x-api-key': 'proxy', ...headers },
    body: JSON.stringify(body),
  })
}

test('llm-proxy: swaps in the stored key and relays the streamed reply untouched', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  secretRow = { api_key: 'sk-ant-real' }
  upstream.mockResolvedValue(new Response('event: message_start\ndata: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  const res = await handle(llmReq({ ...llmBody, stream: true }, { 'anthropic-version': '2023-06-01' }))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('text/event-stream')
  expect(await res.text()).toContain('message_start')
  const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://api.anthropic.com/v1/messages')
  expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-real')
  expect(JSON.parse(String(init.body)).stream).toBe(true)
  expect(inserts.some(i => i.table === 'api_proxy_calls' && i.row.kind === 'llm')).toBe(true)
})

test('llm-proxy: the browser-supplied placeholder key is never forwarded', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  secretRow = { api_key: 'sk-ant-real' }
  upstream.mockResolvedValue(new Response('{}', { status: 200 }))
  await handle(llmReq())
  const sent = JSON.stringify((upstream.mock.calls[0] as [string, RequestInit])[1].headers)
  expect(sent).not.toContain('proxy"')
})

test('llm-proxy: rejects a request with no valid session', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  user = null
  const res = await handle(llmReq())
  expect(res.status).toBe(401)
  expect(upstream).not.toHaveBeenCalled()
})

test('llm-proxy: a disallowed request never reaches Anthropic', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  secretRow = { api_key: 'sk-ant-real' }
  const res = await handle(llmReq({ ...llmBody, model: 'claude-opus-5-5' }))
  expect(res.status).toBe(400)
  expect((await res.json()).error.message).toMatch(/model/)
  expect(upstream).not.toHaveBeenCalled()
})

test('llm-proxy: says how to fix a missing key', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  const res = await handle(llmReq())
  expect(res.status).toBe(409)
  expect((await res.json()).error.message).toMatch(/Add one in Settings/)
})

test('llm-proxy: rate limits per user and tells the client when to retry', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  secretRow = { api_key: 'sk-ant-real' }
  callCount = 60
  const res = await handle(llmReq())
  expect(res.status).toBe(429)
  expect(res.headers.get('Retry-After')).toBe('30')
  expect(upstream).not.toHaveBeenCalled()
})

test('llm-proxy: passes Anthropic errors straight through', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  secretRow = { api_key: 'sk-ant-real' }
  upstream.mockResolvedValue(new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401, headers: { 'content-type': 'application/json' } }))
  const res = await handle(llmReq())
  expect(res.status).toBe(401)
  expect((await res.json()).error.message).toBe('invalid x-api-key')
})

test('llm-proxy: answers CORS preflight and refuses other paths', async () => {
  const { handle } = await import('../../supabase/functions/llm-proxy/index')
  const pre = await handle(new Request('https://abc.supabase.co/functions/v1/llm-proxy/v1/messages', { method: 'OPTIONS' }))
  expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*')
  const sdk = await handle(new Request('https://abc.supabase.co/functions/v1/llm-proxy/v1/messages', {
    method: 'OPTIONS',
    headers: { 'Access-Control-Request-Headers': 'authorization,content-type,x-stainless-lang,anthropic-dangerous-direct-browser-access' },
  }))
  expect(sdk.headers.get('Access-Control-Allow-Headers')).toContain('x-stainless-lang')
  expect(sdk.headers.get('Access-Control-Allow-Headers')).toContain('anthropic-dangerous-direct-browser-access')
  const other = await handle(new Request('https://abc.supabase.co/functions/v1/llm-proxy/v1/models', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: '{}' }))
  expect(other.status).toBe(404)
})

function marketReq(body: unknown) {
  return new Request('https://abc.supabase.co/functions/v1/market-proxy', {
    method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

test('market-proxy: attaches the stored Finnhub key server-side and relays the JSON', async () => {
  const { handle } = await import('../../supabase/functions/market-proxy/index')
  secretRow = { finnhub_api_key: 'fh-real' }
  upstream.mockResolvedValue(new Response('{"c":201.5,"pc":199}', { status: 200, headers: { 'content-type': 'application/json' } }))
  const res = await handle(marketReq({ provider: 'finnhub', path: 'quote', params: { symbol: 'AAPL' } }))
  expect(await res.json()).toEqual({ c: 201.5, pc: 199 })
  expect(upstream.mock.calls[0][0]).toBe('https://finnhub.io/api/v1/quote?symbol=AAPL&token=fh-real')
  expect(inserts.some(i => i.table === 'api_proxy_calls' && i.row.kind === 'market')).toBe(true)
})

test('market-proxy: refuses an unlisted endpoint, an unauthenticated caller and a missing key', async () => {
  const { handle } = await import('../../supabase/functions/market-proxy/index')
  secretRow = { finnhub_api_key: 'fh-real' }
  expect((await handle(marketReq({ provider: 'finnhub', path: 'stock/candle', params: {} }))).status).toBe(400)
  user = null
  expect((await handle(marketReq({ provider: 'finnhub', path: 'quote', params: {} }))).status).toBe(401)
  user = { id: 'u1' }
  secretRow = null
  const res = await handle(marketReq({ provider: 'finnhub', path: 'quote', params: { symbol: 'A' } }))
  expect(res.status).toBe(409)
  expect(upstream).not.toHaveBeenCalled()
})

test('market-proxy: rate limits per user', async () => {
  const { handle } = await import('../../supabase/functions/market-proxy/index')
  secretRow = { finnhub_api_key: 'fh-real' }
  callCount = 600
  const res = await handle(marketReq({ provider: 'finnhub', path: 'quote', params: { symbol: 'A' } }))
  expect(res.status).toBe(429)
})
