const KEYS = {
  supabaseUrl: 'mne_supabase_url',
  supabaseAnonKey: 'mne_supabase_anon_key',
  claudeApiKey: 'mne_claude_api_key',
  finnhubApiKey: 'mne_finnhub_api_key',
}

export const config = {
  get supabaseUrl() { return localStorage.getItem(KEYS.supabaseUrl) ?? '' },
  get supabaseAnonKey() { return localStorage.getItem(KEYS.supabaseAnonKey) ?? '' },
  get claudeApiKey() { return localStorage.getItem(KEYS.claudeApiKey) ?? '' },
  get finnhubApiKey() { return localStorage.getItem(KEYS.finnhubApiKey) ?? '' },
  get isConfigured() {
    return !!(this.supabaseUrl && this.supabaseAnonKey && this.claudeApiKey && this.finnhubApiKey)
  },
  save(data: { supabaseUrl: string; supabaseAnonKey: string; claudeApiKey: string; finnhubApiKey: string }) {
    localStorage.setItem(KEYS.supabaseUrl, data.supabaseUrl)
    localStorage.setItem(KEYS.supabaseAnonKey, data.supabaseAnonKey)
    localStorage.setItem(KEYS.claudeApiKey, data.claudeApiKey)
    localStorage.setItem(KEYS.finnhubApiKey, data.finnhubApiKey)
  },
  clear() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
  }
}
