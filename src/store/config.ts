export type LLMProvider = 'claude' | 'groq' | 'gemini'

const KEYS = {
  claudeApiKey: 'mne_claude_api_key',
  groqApiKey: 'mne_groq_api_key',
  geminiApiKey: 'mne_gemini_api_key',
  llmProvider: 'mne_llm_provider',
  finnhubApiKey: 'mne_finnhub_api_key',
  needsSignIn: 'mne_needs_signin',
  theme: 'mne_theme',
}
const LEGACY_CONNECTION_KEYS = ['mne_supabase_url', 'mne_supabase_anon_key', 'mne_last_user_id']

export const config = {
  get claudeApiKey() { return localStorage.getItem(KEYS.claudeApiKey) ?? '' },
  get groqApiKey() { return localStorage.getItem(KEYS.groqApiKey) ?? '' },
  get geminiApiKey() { return localStorage.getItem(KEYS.geminiApiKey) ?? '' },
  get llmProvider(): LLMProvider {
    const val = localStorage.getItem(KEYS.llmProvider)
    if (val === 'groq' || val === 'gemini') return val
    return 'claude'
  },
  get activeApiKey() {
    const p = this.llmProvider
    if (p === 'groq') return this.groqApiKey
    if (p === 'gemini') return this.geminiApiKey
    return this.claudeApiKey
  },
  get finnhubApiKey() { return localStorage.getItem(KEYS.finnhubApiKey) ?? '' },
  get needsSignIn() { return localStorage.getItem(KEYS.needsSignIn) === 'true' },
  get isConfigured() {
    return !!(this.activeApiKey && this.finnhubApiKey && !this.needsSignIn)
  },
  save(data: {
    claudeApiKey?: string
    groqApiKey?: string
    geminiApiKey?: string
    llmProvider?: LLMProvider
    finnhubApiKey?: string
  }) {
    if (data.claudeApiKey !== undefined) localStorage.setItem(KEYS.claudeApiKey, data.claudeApiKey)
    if (data.groqApiKey !== undefined) localStorage.setItem(KEYS.groqApiKey, data.groqApiKey)
    if (data.geminiApiKey !== undefined) localStorage.setItem(KEYS.geminiApiKey, data.geminiApiKey)
    if (data.llmProvider !== undefined) localStorage.setItem(KEYS.llmProvider, data.llmProvider)
    if (data.finnhubApiKey !== undefined) localStorage.setItem(KEYS.finnhubApiKey, data.finnhubApiKey)
  },
  setLLMProvider(provider: LLMProvider) { localStorage.setItem(KEYS.llmProvider, provider) },
  markSignedOut() {
    localStorage.setItem(KEYS.needsSignIn, 'true')
    ;[KEYS.claudeApiKey, KEYS.groqApiKey, KEYS.geminiApiKey, KEYS.llmProvider, KEYS.finnhubApiKey]
      .forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  clearSignedOut() { localStorage.removeItem(KEYS.needsSignIn) },
  clear() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  get theme(): 'light' | 'dark' | 'system' {
    return (localStorage.getItem(KEYS.theme) ?? 'dark') as 'light' | 'dark' | 'system'
  },
  setTheme(v: 'light' | 'dark' | 'system') { localStorage.setItem(KEYS.theme, v) },
}
