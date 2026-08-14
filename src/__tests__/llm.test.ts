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
