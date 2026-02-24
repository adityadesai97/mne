const KEYS = {
  claudeApiKey: 'mne_claude_api_key',
  finnhubApiKey: 'mne_finnhub_api_key',
  needsSignIn: 'mne_needs_signin',
  theme: 'mne_theme',
}
const LEGACY_CONNECTION_KEYS = ['mne_supabase_url', 'mne_supabase_anon_key', 'mne_last_user_id']

export const config = {
  get claudeApiKey() { return localStorage.getItem(KEYS.claudeApiKey) ?? '' },
  get finnhubApiKey() { return localStorage.getItem(KEYS.finnhubApiKey) ?? '' },
  get needsSignIn() { return localStorage.getItem(KEYS.needsSignIn) === 'true' },
  get isConfigured() { return !!(this.claudeApiKey && this.finnhubApiKey && !this.needsSignIn) },
  save(data: { claudeApiKey: string; finnhubApiKey: string }) {
    localStorage.setItem(KEYS.claudeApiKey, data.claudeApiKey)
    localStorage.setItem(KEYS.finnhubApiKey, data.finnhubApiKey)
  },
  markSignedOut() {
    localStorage.setItem(KEYS.needsSignIn, 'true')
    localStorage.removeItem(KEYS.claudeApiKey)
    localStorage.removeItem(KEYS.finnhubApiKey)
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
