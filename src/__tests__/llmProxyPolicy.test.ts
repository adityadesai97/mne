import { test, expect } from 'vitest'
import { validateLlmRequest, bearerToken, MAX_OUTPUT_TOKENS } from '../../supabase/functions/llm-proxy/index'

const ok = { model: 'claude-sonnet-5', max_tokens: 8192, messages: [{ role: 'user', content: 'hi' }] }

test('accepts the request shape mne sends', () => {
  expect(validateLlmRequest(ok)).toBeNull()
  expect(validateLlmRequest({ ...ok, system: 's', temperature: 0, stream: true, output_config: { effort: 'low' } })).toBeNull()
})

test('accepts custom tools and the web search server tool', () => {
  const tools = [
    { name: 'get_positions', description: 'x', input_schema: { type: 'object' } },
    { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
  ]
  expect(validateLlmRequest({ ...ok, tools })).toBeNull()
})

test('rejects other server tools so a stolen session cannot run arbitrary tools', () => {
  expect(validateLlmRequest({ ...ok, tools: [{ type: 'code_execution_20250522', name: 'code_execution' }] })).toMatch(/tool type/)
})

test('rejects models mne does not use', () => {
  expect(validateLlmRequest({ ...ok, model: 'claude-opus-5-5' })).toMatch(/model/)
  expect(validateLlmRequest({ ...ok, model: undefined })).toMatch(/model/)
})

test('caps max_tokens', () => {
  expect(validateLlmRequest({ ...ok, max_tokens: MAX_OUTPUT_TOKENS + 1 })).toMatch(/max_tokens/)
  expect(validateLlmRequest({ ...ok, max_tokens: 0 })).toMatch(/max_tokens/)
  expect(validateLlmRequest({ ...ok, max_tokens: 'lots' })).toMatch(/max_tokens/)
})

test('rejects unknown fields and bad bodies', () => {
  expect(validateLlmRequest({ ...ok, metadata: { user_id: 'x' } })).toMatch(/not allowed/)
  expect(validateLlmRequest(null)).toMatch(/JSON object/)
  expect(validateLlmRequest([])).toMatch(/JSON object/)
  expect(validateLlmRequest({ ...ok, messages: [] })).toMatch(/messages/)
})

test('bearerToken strips the prefix', () => {
  expect(bearerToken('Bearer abc.def')).toBe('abc.def')
  expect(bearerToken('bearer  abc')).toBe('abc')
  expect(bearerToken(null)).toBe('')
})
