import { test, expect } from 'vitest'
import { MODEL_FOR_PROVIDER } from '@/lib/llm'
import type { LLMProvider } from '@/store/config'

test('MODEL_FOR_PROVIDER has an entry for each provider', () => {
  const providers: LLMProvider[] = ['claude', 'groq', 'gemini']
  for (const p of providers) {
    expect(MODEL_FOR_PROVIDER[p]).toBeTruthy()
  }
})
