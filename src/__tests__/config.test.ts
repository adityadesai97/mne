import { test, expect, beforeEach } from 'vitest'
import { config } from '@/store/config'

beforeEach(() => localStorage.clear())

test('isConfigured is true with a server-side Claude key flag and a Finnhub key', () => {
  config.save({ llmKeySet: true, finnhubApiKey: 'finn_xxx' })
  expect(config.isConfigured).toBe(true)
})

test('isConfigured stays true for a pre-proxy browser-held key until it is migrated', () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  config.save({ finnhubApiKey: 'finn_xxx' })
  expect(config.isConfigured).toBe(true)
  expect(config.llmKeySet).toBe(false)
})

test('isConfigured is false with no Claude key anywhere', () => {
  config.save({ finnhubApiKey: 'finn_xxx' })
  expect(config.isConfigured).toBe(false)
})

test('isConfigured is false when Finnhub is missing', () => {
  config.save({ llmKeySet: true })
  expect(config.isConfigured).toBe(false)
})

test('isConfigured is false when the user needs to sign in', () => {
  config.save({ llmKeySet: true, finnhubApiKey: 'finn_xxx' })
  config.markSignedOut()
  expect(config.isConfigured).toBe(false)
  expect(config.llmKeySet).toBe(false)
})

test('clearing the legacy key leaves the server-side flag alone', () => {
  localStorage.setItem('mne_claude_api_key', 'sk-ant-old')
  config.save({ llmKeySet: true })
  config.clearLegacyClaudeApiKey()
  expect(config.legacyClaudeApiKey).toBe('')
  expect(config.llmKeySet).toBe(true)
})

test('sign-out also wipes leftover Groq and provider keys from older versions', () => {
  localStorage.setItem('mne_groq_api_key', 'gsk_old')
  localStorage.setItem('mne_llm_provider', 'groq')
  config.markSignedOut()
  expect(localStorage.getItem('mne_groq_api_key')).toBeNull()
  expect(localStorage.getItem('mne_llm_provider')).toBeNull()
})
