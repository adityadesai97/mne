const KEYS = {
  // The Claude key itself lives server-side (llm_credential_secrets); this is
  // only the "a key is saved" flag. mne_claude_api_key is the pre-proxy copy
  // of the key, kept readable only so it can be moved to the server once.
  llmKeySet: 'mne_llm_key_set',
  legacyClaudeApiKey: 'mne_claude_api_key',
  // Finnhub and CoinGecko keys live server-side too (market_credential_secrets);
  // these are the "saved" flags, and the old key names are kept readable only
  // so existing keys can be moved to the server once.
  finnhubKeySet: 'mne_finnhub_key_set',
  coingeckoKeySet: 'mne_coingecko_key_set',
  legacyFinnhubApiKey: 'mne_finnhub_api_key',
  legacyCoingeckoApiKey: 'mne_coingecko_api_key',
  needsSignIn: 'mne_needs_signin',
  theme: 'mne_theme',
  assetView: 'mne_asset_view',
  lotView: 'mne_lot_view',
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
  /** True once a Finnhub key is saved server-side for this account. */
  get finnhubKeySet() { return localStorage.getItem(KEYS.finnhubKeySet) === 'true' },
  // Optional — crypto pricing works keyless, a CoinGecko Demo key just lifts
  // the (much tighter) keyless rate limit.
  get coingeckoKeySet() { return localStorage.getItem(KEYS.coingeckoKeySet) === 'true' },
  /** Old browser-held copies, present only until migrateLegacyMarketKeys() moves them to the server. */
  get legacyFinnhubApiKey() { return localStorage.getItem(KEYS.legacyFinnhubApiKey) ?? '' },
  get legacyCoingeckoApiKey() { return localStorage.getItem(KEYS.legacyCoingeckoApiKey) ?? '' },
  /** A Finnhub key is saved server-side (or still waiting to be moved there). */
  get hasFinnhubKey() { return this.finnhubKeySet || !!this.legacyFinnhubApiKey },
  get needsSignIn() { return localStorage.getItem(KEYS.needsSignIn) === 'true' },
  // Whether the onboarding wizard's optional Plaid step has already been
  // shown (completed or explicitly skipped) — not a credential, just a
  // "don't re-prompt" flag. Actual Plaid connection state lives in the
  // plaid_credentials/plaid_items DB tables, not here.
  get plaidOnboardingSeen() { return localStorage.getItem(KEYS.plaidOnboardingSeen) === 'true' },
  get isConfigured() {
    return !!((this.llmKeySet || this.legacyClaudeApiKey) && (this.finnhubKeySet || this.legacyFinnhubApiKey) && !this.needsSignIn)
  },
  save(data: {
    llmKeySet?: boolean
    finnhubKeySet?: boolean
    coingeckoKeySet?: boolean
    plaidOnboardingSeen?: boolean
  }) {
    if (data.llmKeySet !== undefined) localStorage.setItem(KEYS.llmKeySet, data.llmKeySet ? 'true' : 'false')
    if (data.finnhubKeySet !== undefined) localStorage.setItem(KEYS.finnhubKeySet, data.finnhubKeySet ? 'true' : 'false')
    if (data.coingeckoKeySet !== undefined) localStorage.setItem(KEYS.coingeckoKeySet, data.coingeckoKeySet ? 'true' : 'false')
    if (data.plaidOnboardingSeen !== undefined) localStorage.setItem(KEYS.plaidOnboardingSeen, data.plaidOnboardingSeen ? 'true' : 'false')
  },
  clearLegacyClaudeApiKey() { localStorage.removeItem(KEYS.legacyClaudeApiKey) },
  clearLegacyMarketKeys() {
    localStorage.removeItem(KEYS.legacyFinnhubApiKey)
    localStorage.removeItem(KEYS.legacyCoingeckoApiKey)
  },
  markSignedOut() {
    localStorage.setItem(KEYS.needsSignIn, 'true')
    ;[KEYS.llmKeySet, KEYS.legacyClaudeApiKey, KEYS.finnhubKeySet, KEYS.coingeckoKeySet, KEYS.legacyFinnhubApiKey, KEYS.legacyCoingeckoApiKey, KEYS.plaidOnboardingSeen]
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
  /** How an asset's tax lots are laid out: 'default' (summary first) or 'timeline'. */
  get lotView(): 'default' | 'timeline' {
    try { return localStorage.getItem(KEYS.lotView) === 'timeline' ? 'timeline' : 'default' } catch { return 'default' }
  },
  setLotView(v: 'default' | 'timeline') { try { localStorage.setItem(KEYS.lotView, v) } catch { /* private mode */ } },
  get hideValues(): boolean {
    return localStorage.getItem(KEYS.hideValues) === 'true'
  },
  setHideValues(v: boolean) { localStorage.setItem(KEYS.hideValues, v ? 'true' : 'false') },
}
