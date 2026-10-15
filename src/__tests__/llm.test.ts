import { test, expect, vi } from 'vitest'
import { MODEL_FOR_PROVIDER, createLLMClient } from '@/lib/llm'
import type { LLMProvider } from '@/store/config'

test('MODEL_FOR_PROVIDER has an entry for each provider', () => {
  const providers: LLMProvider[] = ['claude', 'groq']
  for (const p of providers) {
    expect(MODEL_FOR_PROVIDER[p]).toBeTruthy()
  }
})

// The OpenAI SDK streams tool-call argument JSON as fragments, indexed by
// position — arrival order across indices isn't guaranteed. GroqAdapter has
// to accumulate per-index rather than concatenating chunks as they arrive,
// so this is the one piece of the streaming plumbing worth a direct test.
vi.mock('openai', () => {
  async function* fakeStream() {
    yield { choices: [{ delta: { content: 'Sure' } }] }
    yield { choices: [{ delta: { content: ', checking' } }] }
    // Two tool calls interleaved by index, each split into id/name/args
    // fragments — mirrors how the real API streams multi-tool-call replies.
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_', arguments: '' } }] } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'get_', arguments: '' } }] } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'positions', arguments: '{"limit"' } }] } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'exposure', arguments: '{"by"' } }] } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':5}' } }] } }] }
    yield { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: ':"ticker"}' } }] } }] }
    // The usage-only trailing chunk (stream_options.include_usage) has an
    // empty choices array and no delta to read — only a top-level `usage`.
    yield { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } }
  }

  class FakeOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => fakeStream()),
      },
    }
  }
  return { default: FakeOpenAI }
})

test('groq adapter accumulates streamed text and per-index tool-call fragments', async () => {
  const client = createLLMClient('groq', 'fake-key')
  const deltas: string[] = []
  let streamStarted = false

  const response = await client.chat.completions.create(
    { model: MODEL_FOR_PROVIDER.groq, messages: [{ role: 'user', content: 'hi' }] },
    {
      onStreamStart: () => { streamStarted = true },
      onTextDelta: (delta) => deltas.push(delta),
    },
  )

  expect(streamStarted).toBe(true)
  expect(deltas.join('')).toBe('Sure, checking')
  expect(response.choices[0].message.content).toBe('Sure, checking')

  const toolCalls = response.choices[0].message.tool_calls
  expect(toolCalls).toHaveLength(2)
  expect(toolCalls?.[0]).toEqual({
    id: 'call_a',
    type: 'function',
    function: { name: 'get_positions', arguments: '{"limit":5}' },
  })
  expect(toolCalls?.[1]).toEqual({
    id: 'call_b',
    type: 'function',
    function: { name: 'get_exposure', arguments: '{"by":"ticker"}' },
  })
})

test('groq adapter requests stream_options.include_usage and normalizes the returned usage', async () => {
  const client = createLLMClient('groq', 'fake-key')
  const response = await client.chat.completions.create({ model: MODEL_FOR_PROVIDER.groq, messages: [{ role: 'user', content: 'hi' }] })

  expect(response.usage).toEqual({ inputTokens: 42, outputTokens: 7 })
})

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
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

test('claude adapter normalizes Anthropic usage into the shared shape', async () => {
  const client = createLLMClient('claude', 'fake-key')
  const response = await client.chat.completions.create({ model: MODEL_FOR_PROVIDER.claude, messages: [{ role: 'user', content: 'hi' }] })

  expect(response.choices[0].message.content).toBe('ok')
  expect(response.usage).toEqual({ inputTokens: 55, outputTokens: 12 })
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
  const result = await claudeWebSearch('key', 'q')
  expect(result.answer).toBe('Earnings are on Dec 3.')
  expect(result.sources.map(s => s.url)).toEqual(['https://example.com/ir', 'https://example.com/news'])
  expect(result.usage).toEqual({ inputTokens: 5400, outputTokens: 120 })
  vi.doUnmock('@anthropic-ai/sdk')
})
