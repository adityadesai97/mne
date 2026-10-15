const KEYS = {
  // The Claude key itself lives server-side (llm_credential_secrets); this is
  // only the "a key is saved" flag. mne_claude_api_key is the pre-proxy copy
  // of the key, kept readable only so it can be moved to the server once.
  llmKeySet: 'mne_llm_key_set',
  legacyClaudeApiKey: 'mne_claude_api_key',
  finnhubApiKey: 'mne_finnhub_api_key',
  coingeckoApiKey: 'mne_coingecko_api_key',
  needsSignIn: 'mne_needs_signin',
  theme: 'mne_theme',
  assetView: 'mne_asset_view',
  hideValues: 'mne_hide_values',
  plaidOnboardingSeen: 'mne_plaid_onboarding_seen',
}
const LEGACY_CONNECTION_KEYS = ['mne_supabase_url', 'mne_supabase_anon_key', 'mne_last_user_id']
const LEGACY_PROVIDER_KEYS = ['mne_gemini_api_key', 'mne_groq_api_key', 'mne_llm_provider']

export const config = {
  /** True once a Claude API key is saved server-side for this account. */
  get llmKeySet() { return localStorage.getItem(KEYS.llmKeySet) === 'true' },
  /** The old browser-held key, present only until migrateLegacyClaudeKey() moves it to the server. */
  get legacyClaudeApiKey() { return localStorage.getItem(KEYS.legacyClaudeApiKey) ?? '' },
  get finnhubApiKey() { return localStorage.getItem(KEYS.finnhubApiKey) ?? '' },
  // Optional — crypto pricing works keyless, a CoinGecko Demo key just lifts
  // the (much tighter) keyless rate limit.
  get coingeckoApiKey() { return localStorage.getItem(KEYS.coingeckoApiKey) ?? '' },
  get needsSignIn() { return localStorage.getItem(KEYS.needsSignIn) === 'true' },
  // Whether the onboarding wizard's optional Plaid step has already been
  // shown (completed or explicitly skipped) — not a credential, just a
  // "don't re-prompt" flag. Actual Plaid connection state lives in the
  // plaid_credentials/plaid_items DB tables, not here.
  get plaidOnboardingSeen() { return localStorage.getItem(KEYS.plaidOnboardingSeen) === 'true' },
  get isConfigured() {
    return !!((this.llmKeySet || this.legacyClaudeApiKey) && this.finnhubApiKey && !this.needsSignIn)
  },
  save(data: {
    llmKeySet?: boolean
    finnhubApiKey?: string
    coingeckoApiKey?: string
    plaidOnboardingSeen?: boolean
  }) {
    if (data.llmKeySet !== undefined) localStorage.setItem(KEYS.llmKeySet, data.llmKeySet ? 'true' : 'false')
    if (data.finnhubApiKey !== undefined) localStorage.setItem(KEYS.finnhubApiKey, data.finnhubApiKey)
    if (data.coingeckoApiKey !== undefined) localStorage.setItem(KEYS.coingeckoApiKey, data.coingeckoApiKey)
    if (data.plaidOnboardingSeen !== undefined) localStorage.setItem(KEYS.plaidOnboardingSeen, data.plaidOnboardingSeen ? 'true' : 'false')
  },
  clearLegacyClaudeApiKey() { localStorage.removeItem(KEYS.legacyClaudeApiKey) },
  markSignedOut() {
    localStorage.setItem(KEYS.needsSignIn, 'true')
    ;[KEYS.llmKeySet, KEYS.legacyClaudeApiKey, KEYS.finnhubApiKey, KEYS.coingeckoApiKey, KEYS.plaidOnboardingSeen]
      .forEach(k => localStorage.removeItem(k))
    LEGACY_PROVIDER_KEYS.forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  clearSignedOut() { localStorage.removeItem(KEYS.needsSignIn) },
  clear() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
    LEGACY_PROVIDER_KEYS.forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  get theme(): 'light' | 'dark' | 'system' {
    return (localStorage.getItem(KEYS.theme) ?? 'dark') as 'light' | 'dark' | 'system'
  },
  setTheme(v: 'light' | 'dark' | 'system') { localStorage.setItem(KEYS.theme, v) },
  // null means the user has never explicitly chosen a view — callers should
  // fall back to a device-appropriate default (list on mobile, grid on desktop).
  get assetView(): 'grid' | 'list' | null {
    const v = localStorage.getItem(KEYS.assetView)
    return v === 'grid' || v === 'list' ? v : null
  },
  setAssetView(v: 'grid' | 'list') { localStorage.setItem(KEYS.assetView, v) },
  get hideValues(): boolean {
    return localStorage.getItem(KEYS.hideValues) === 'true'
  },
  setHideValues(v: boolean) { localStorage.setItem(KEYS.hideValues, v ? 'true' : 'false') },
}
