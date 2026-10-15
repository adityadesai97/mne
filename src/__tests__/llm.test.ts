import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LLM_MODEL, createLLMClient } from '@/lib/llm'

// The browser never holds the Claude key: the SDK is pointed at the llm-proxy
// edge function and authenticates with the Supabase session instead.
const sdkOptions: any[] = []
const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: () => ({ auth: { getSession } }),
}))

test('LLM_MODEL is set', () => {
  expect(LLM_MODEL).toBeTruthy()
})

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    constructor(opts: any) { sdkOptions.push(opts) }
    messages = {
      stream: vi.fn(() => ({
        on: vi.fn(),
        finalMessage: vi.fn(async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 55, output_tokens: 12 },
        })),
      })),
    }
  }
  return { default: FakeAnthropic }
})

beforeEach(() => {
  sdkOptions.length = 0
  getSession.mockReset()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test('claude adapter normalizes Anthropic usage into the shared shape', async () => {
  const client = createLLMClient()
  const response = await client.chat.completions.create({ model: LLM_MODEL, messages: [{ role: 'user', content: 'hi' }] })

  expect(response.choices[0].message.content).toBe('ok')
  expect(response.usage).toEqual({ inputTokens: 55, outputTokens: 12 })
})

test('the SDK is pointed at the llm-proxy and holds no real API key', () => {
  createLLMClient()
  expect(sdkOptions[0].baseURL).toBe('https://abc.supabase.co/functions/v1/llm-proxy')
  expect(sdkOptions[0].apiKey).toBe('proxy')
  expect(typeof sdkOptions[0].fetch).toBe('function')
})

test('proxy requests carry the signed-in user\'s session token', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } })
  const fetchMock = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
  createLLMClient()
  await sdkOptions[0].fetch('https://abc.supabase.co/functions/v1/llm-proxy/v1/messages', { method: 'POST', headers: { 'x-api-key': 'proxy' } })
  const sent = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
  expect(new Headers(sent.headers).get('Authorization')).toBe('Bearer jwt-123')
})

test('proxy requests fail clearly when signed out', async () => {
  getSession.mockResolvedValue({ data: { session: null } })
  createLLMClient()
  await expect(sdkOptions[0].fetch('https://x', {})).rejects.toThrow(/signed out/i)
})

test('claudeWebSearch extracts the answer, de-duplicated sources and the call\'s token usage', async () => {
  vi.resetModules()
  vi.doMock('@anthropic-ai/sdk', () => ({
    default: class {
      messages = {
        create: vi.fn(async () => ({
          content: [
            { type: 'server_tool_use', name: 'web_search' },
            { type: 'web_search_tool_result', content: [
              { title: 'IR page', url: 'https://example.com/ir' },
              { title: 'IR page again', url: 'https://example.com/ir' },
              { title: 'News', url: 'https://example.com/news' },
            ] },
            { type: 'text', text: 'Earnings are ' },
            { type: 'text', text: 'on Dec 3.' },
          ],
          usage: { input_tokens: 5400, output_tokens: 120 },
        })),
      }
    },
  }))
  const { claudeWebSearch } = await import('@/lib/llm')
  const result = await claudeWebSearch('q')
  expect(result.answer).toBe('Earnings are on Dec 3.')
  expect(result.sources.map(s => s.url)).toEqual(['https://example.com/ir', 'https://example.com/news'])
  expect(result.usage).toEqual({ inputTokens: 5400, outputTokens: 120 })
  vi.doUnmock('@anthropic-ai/sdk')
})
