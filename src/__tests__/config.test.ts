import { test, expect } from 'vitest'

// Inline a minimal config replica to test logic without side effects
function makeIsConfigured(claudeKey: string, groqKey: string, geminiKey: string, provider: string, finnhubKey: string, needsSignIn: boolean) {
  const activeKey = provider === 'groq' ? groqKey : provider === 'gemini' ? geminiKey : claudeKey
  return !!(activeKey && finnhubKey && !needsSignIn)
}

test('isConfigured true when active provider has key + finnhub', () => {
  expect(makeIsConfigured('', 'gsk_xxx', '', 'groq', 'finn_xxx', false)).toBe(true)
})

test('isConfigured false when active provider has no key', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'groq', 'finn_xxx', false)).toBe(false)
})

test('isConfigured false when finnhub missing', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'claude', '', false)).toBe(false)
})

test('isConfigured false when needsSignIn', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'claude', 'finn_xxx', true)).toBe(false)
})
