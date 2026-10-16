// src/pages/Settings.tsx
import { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/db/settings'
import { saveLlmKey } from '@/lib/db/llmCredentials'
import { saveMarketKeys } from '@/lib/db/marketCredentials'
import '@/styles/settings.css'
import { Field, PageHead, SegmentedControl, Switch } from '@/components/mne'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { config } from '@/store/config'
import { exportData, importData, setActiveImportController, type ExportScope } from '@/lib/importExport'
import { subscribeToPush, unsubscribeFromPush, getPushEnabled } from '@/lib/pushNotifications'
import { getSupabaseClient } from '@/lib/supabase'
import { applyTheme } from '@/lib/theme'
import { useHideValues } from '@/hooks/useHideValues'
import { listConversations, deleteConversation, type ConversationSummary } from '@/lib/db/conversations'
import { resumeConversationInCommandBar } from '@/lib/commandBarBridge'
import { formatDateMDY } from '@/lib/dates'
import { ExternalLink, Loader2, Trash2 } from 'lucide-react'
import {
  getPlaidCredentialsStatus,
  savePlaidCredentials,
  listPlaidItems,
  listPlaidDriftPositions,
  listHeldLotSells,
  resolvePlaidDrift,
  disconnectPlaidItem,
  listLinkedAssetsForItem,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  syncPlaidNow,
  getPendingPlaidPositionsCount,
  PLAID_ITEM_LIMIT,
  type PlaidItem,
  type PlaidDriftPosition,
  type HeldLotSell,
  type LinkedPlaidAsset,
} from '@/lib/db/plaid'
import { openPlaidLink } from '@/lib/plaidLink'
import { showAppAlert } from '@/lib/appAlerts'
import { PlaidReviewModal } from '@/components/PlaidReviewModal'
import { PlaidLotSellModal } from '@/components/PlaidLotSellModal'
import { PlaidDisconnectDialog } from '@/components/PlaidDisconnectDialog'
import { notifyPlaidPendingChanged } from '@/lib/plaidEvents'

export default function Settings() {
  const [settings, setSettings] = useState({
    price_alert_threshold: 5,
    rsu_alert_days_before: 7,
    auto_theme_assignment_enabled: true,
    price_alerts_enabled: true,
    vest_alerts_enabled: true,
    capital_gains_alerts_enabled: true,
  })
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(config.theme)
  const [hideValues, setHideValues] = useHideValues()
  const [editingKeys, setEditingKeys] = useState(false)
  const [keyDraft, setKeyDraft] = useState({ claudeApiKey: '', finnhubApiKey: '', coingeckoApiKey: '' })
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [plaidStatus, setPlaidStatus] = useState({ configured: false, clientId: null as string | null, plaidEnv: 'production' })
  const [editingPlaidCreds, setEditingPlaidCreds] = useState(false)
  const [plaidCredsDraft, setPlaidCredsDraft] = useState({ clientId: '', secret: '' })
  const [plaidCredsSaving, setPlaidCredsSaving] = useState(false)
  const [plaidCredsError, setPlaidCredsError] = useState('')
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([])
  const [plaidConnecting, setPlaidConnecting] = useState(false)
  const [plaidSyncing, setPlaidSyncing] = useState(false)
  const [plaidRemovingId, setPlaidRemovingId] = useState<string | null>(null)
  const [plaidPendingCount, setPlaidPendingCount] = useState(0)
  const [plaidDrift, setPlaidDrift] = useState<PlaidDriftPosition[]>([])
  const [plaidResolvingId, setPlaidResolvingId] = useState<string | null>(null)
  const [plaidReviewOpen, setPlaidReviewOpen] = useState(false)
  const [plaidHeldSells, setPlaidHeldSells] = useState<HeldLotSell[]>([])
  const [plaidDisconnecting, setPlaidDisconnecting] = useState<{ item: PlaidItem; assets: LinkedPlaidAsset[] | null } | null>(null)
  const [plaidMatchingSell, setPlaidMatchingSell] = useState<HeldLotSell | null>(null)
  const [plaidError, setPlaidError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [allowedEmails, setAllowedEmails] = useState<{ id: string; email: string; is_admin: boolean }[]>([])
  const [newAllowedEmail, setNewAllowedEmail] = useState('')
  const [newAllowedEmailIsAdmin, setNewAllowedEmailIsAdmin] = useState(false)
  const [allowlistLoading, setAllowlistLoading] = useState(false)
  const [allowlistError, setAllowlistError] = useState('')

  const [importLoading, setImportLoading] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportingScope, setExportingScope] = useState<ExportScope | null>(null)
  const [showConversationHistory, setShowConversationHistory] = useState(false)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const importAbortRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    getSettings()
      .then(s => {
        if (!s) return
        setSettings(prev => ({
          ...prev,
          ...(s as any),
          auto_theme_assignment_enabled: (s as any).auto_theme_assignment_enabled !== false,
        }))
      })
      .catch(console.error)
    getPushEnabled().then(setPushEnabled)
    void refreshPlaidData()

    // Check admin status
    getSupabaseClient().auth.getUser().then(({ data: { user } }) => {
      if (!user?.email) return
      getSupabaseClient()
        .from('allowed_emails')
        .select('email')
        .eq('email', user.email.toLowerCase())
        .eq('is_admin', true)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setIsAdmin(true)
            loadAllowedEmails()
          }
        })
    })
  }, [])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      importAbortRef.current?.abort()
      setActiveImportController(null)
    }
  }, [])

  function handleThemeChange(v: 'light' | 'dark' | 'system') {
    config.setTheme(v)
    applyTheme(v)
    setThemeState(v)
  }

  async function setAutoThemeAssignmentEnabled(enabled: boolean) {
    const next = { ...settingsRef.current, auto_theme_assignment_enabled: enabled }
    setSettings(next)
    settingsRef.current = next
    try {
      await saveSettings(next)
    } catch (error) {
      console.error('Failed to save auto-theme setting', error)
      const rollback = { ...next, auto_theme_assignment_enabled: !enabled }
      setSettings(rollback)
      settingsRef.current = rollback
    }
  }

  async function setNotificationToggle(field: 'price_alerts_enabled' | 'vest_alerts_enabled' | 'capital_gains_alerts_enabled', enabled: boolean) {
    const next = { ...settingsRef.current, [field]: enabled }
    setSettings(next)
    settingsRef.current = next
    try {
      await saveSettings(next)
    } catch {
      const rollback = { ...next, [field]: !enabled }
      setSettings(rollback)
      settingsRef.current = rollback
    }
  }

  async function handleSaveKeys() {
    if (!keyDraft.finnhubApiKey && !config.hasFinnhubKey) { setKeyError('Finnhub API key is required'); return }
    if (!keyDraft.claudeApiKey && !config.llmKeySet) { setKeyError('A Claude API key is required'); return }
    setKeySaving(true)
    setKeyError('')
    try {
      // API keys are write-only: they go to the server and are never stored
      // in the browser or in a table the browser can read.
      if (keyDraft.claudeApiKey) await saveLlmKey(keyDraft.claudeApiKey)
      await saveMarketKeys({ finnhubApiKey: keyDraft.finnhubApiKey, coingeckoApiKey: keyDraft.coingeckoApiKey })
      setEditingKeys(false)
    } catch (e: any) {
      setKeyError(e.message ?? 'Failed to save')
    } finally {
      setKeySaving(false)
    }
  }

  async function refreshPlaidData() {
    try {
      const [status, items, pendingCount, drift, heldSells] = await Promise.all([
        getPlaidCredentialsStatus(),
        listPlaidItems(),
        getPendingPlaidPositionsCount(),
        listPlaidDriftPositions().catch(() => [] as PlaidDriftPosition[]),
        listHeldLotSells().catch(() => [] as HeldLotSell[]),
      ])
      setPlaidStatus(status)
      setPlaidItems(items)
      setPlaidPendingCount(pendingCount)
      setPlaidDrift(drift)
      setPlaidHeldSells(heldSells)
      // Keep the top-of-app banner's count in step with the one just read.
      notifyPlaidPendingChanged()
    } catch (e) {
      // Plaid tables may not exist yet on an older self-hosted schema —
      // fail quietly rather than blocking the rest of Settings.
      console.error(e)
    }
  }

  async function handleSavePlaidCreds() {
    if (!plaidCredsDraft.clientId || (!plaidStatus.configured && !plaidCredsDraft.secret)) {
      setPlaidCredsError('Client ID and Secret are required')
      return
    }
    setPlaidCredsSaving(true)
    setPlaidCredsError('')
    try {
      await savePlaidCredentials(plaidCredsDraft.clientId, plaidStatus.plaidEnv || 'production', plaidCredsDraft.secret)
      setEditingPlaidCreds(false)
      await refreshPlaidData()
    } catch (e: any) {
      setPlaidCredsError(e.message ?? 'Failed to save')
    } finally {
      setPlaidCredsSaving(false)
    }
  }

  async function handleConnectPlaidAccount() {
    setPlaidConnecting(true)
    setPlaidError('')
    try {
      const linkToken = await createPlaidLinkToken()
      await openPlaidLink(linkToken, {
        onSuccess: (publicToken, metadata) => {
          exchangePlaidPublicToken(publicToken, metadata.institution?.institution_id ?? null, metadata.institution?.name ?? null)
            .then(({ pendingCount }) => {
              showAppAlert(
                pendingCount > 0
                  ? `Connected — ${pendingCount} position${pendingCount !== 1 ? 's' : ''} to review`
                  : 'Account connected',
                { variant: 'success' },
              )
              void refreshPlaidData()
            })
            .catch((e: Error) => showAppAlert(e.message || 'Failed to finish connecting that account', { variant: 'error' }))
            .finally(() => setPlaidConnecting(false))
        },
        onExit: () => setPlaidConnecting(false),
      })
    } catch (e: any) {
      setPlaidError(e.message ?? 'Failed to start Plaid Link')
      setPlaidConnecting(false)
    }
  }

  async function handleSyncPlaidNow() {
    setPlaidSyncing(true)
    setPlaidError('')
    try {
      const { pendingCount } = await syncPlaidNow()
      showAppAlert(pendingCount > 0 ? `${pendingCount} position${pendingCount !== 1 ? 's' : ''} to review` : 'Up to date', { variant: 'success' })
      await refreshPlaidData()
    } catch (e: any) {
      setPlaidError(e.message ?? 'Sync failed')
    } finally {
      setPlaidSyncing(false)
    }
  }

  async function handleResolvePlaidDrift(pos: PlaidDriftPosition) {
    setPlaidResolvingId(pos.id)
    try {
      await resolvePlaidDrift(pos)
      await refreshPlaidData()
    } catch (e: any) {
      showAppAlert(e.message ?? 'Failed to update position', { variant: 'error' })
    } finally {
      setPlaidResolvingId(null)
    }
  }

  // Opens the disconnect dialog; what happens to the linked assets is the user's call.
  async function startDisconnectPlaidItem(item: PlaidItem) {
    setPlaidDisconnecting({ item, assets: null })
    try {
      const assets = await listLinkedAssetsForItem(item.id)
      setPlaidDisconnecting({ item, assets })
    } catch {
      // Couldn't list them: offer the safe path only (the dialog shows no delete option for an empty list).
      setPlaidDisconnecting({ item, assets: [] })
    }
  }

  async function handleDisconnectPlaidItem(deleteAssets: boolean) {
    if (!plaidDisconnecting) return
    const { item } = plaidDisconnecting
    setPlaidRemovingId(item.id)
    try {
      const { deleted, failed } = await disconnectPlaidItem(item.id, { deleteAssets })
      setPlaidDisconnecting(null)
      await refreshPlaidData()
      if (failed.length > 0) {
        showAppAlert(`Disconnected, but couldn't delete: ${failed.join(', ')}`, { variant: 'error' })
      } else if (deleteAssets) {
        showAppAlert(`Disconnected and deleted ${deleted} asset${deleted !== 1 ? 's' : ''}`, { variant: 'success' })
      }
    } catch (e: any) {
      showAppAlert(e.message ?? 'Failed to disconnect', { variant: 'error' })
    } finally {
      setPlaidRemovingId(null)
    }
  }

  async function loadAllowedEmails() {
    const { data } = await getSupabaseClient()
      .from('allowed_emails')
      .select('id, email, is_admin')
      .order('email')
    if (data) setAllowedEmails(data)
  }

  async function handleAddAllowedEmail() {
    const email = newAllowedEmail.trim().toLowerCase()
    if (!email) return
    setAllowlistLoading(true)
    setAllowlistError('')
    const { error } = await getSupabaseClient()
      .from('allowed_emails')
      .insert({ email, is_admin: newAllowedEmailIsAdmin })
    setAllowlistLoading(false)
    if (error) {
      setAllowlistError(error.message)
    } else {
      setNewAllowedEmail('')
      setNewAllowedEmailIsAdmin(false)
      await loadAllowedEmails()
    }
  }

  async function handleToggleAdmin(id: string, is_admin: boolean) {
    await getSupabaseClient().from('allowed_emails').update({ is_admin }).eq('id', id)
    setAllowedEmails(prev => prev.map(e => e.id === id ? { ...e, is_admin } : e))
  }

  async function handleRemoveAllowedEmail(id: string) {
    await getSupabaseClient().from('allowed_emails').delete().eq('id', id)
    setAllowedEmails(prev => prev.filter(e => e.id !== id))
  }

  async function loadConversations() {
    setConversationsLoading(true)
    setConversationsError('')
    try {
      setConversations(await listConversations())
    } catch (e: any) {
      setConversationsError(e.message ?? 'Failed to load conversations')
    } finally {
      setConversationsLoading(false)
    }
  }

  function openConversationHistory() {
    setShowConversationHistory(true)
    void loadConversations()
  }

  function handleContinueConversation(id: string) {
    resumeConversationInCommandBar(id)
    setShowConversationHistory(false)
  }

  async function handleDeleteConversation(id: string) {
    try {
      await deleteConversation(id)
      setConversations(prev => prev.filter(c => c.id !== id))
    } catch (e: any) {
      setConversationsError(e.message ?? 'Failed to delete conversation')
    }
  }

  async function handleSignOut() {
    await getSupabaseClient().auth.signOut()
    config.markSignedOut()
    window.location.href = '/'
  }

  async function handleImportFile(file: File) {
    if (!file || importLoading) return

    const controller = new AbortController()
    importAbortRef.current = controller
    setActiveImportController(controller)
    setImportLoading(true)

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const handlePageHide = () => {
      controller.abort()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)

    try {
      await importData(file, { signal: controller.signal })
    } finally {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', handlePageHide)
      importAbortRef.current = null
      setActiveImportController(null)
      if (isMountedRef.current) {
        setImportLoading(false)
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleExport(scope: ExportScope) {
    if (exportingScope) return
    setExportingScope(scope)
    try {
      await exportData(scope)
      setExportDialogOpen(false)
    } finally {
      if (isMountedRef.current) setExportingScope(null)
    }
  }

  const pushToggleBusy = pushLoading

  async function enablePush() {
    setPushEnabled(true)
    setPushLoading(true)
    try {
      await subscribeToPush()
      const next = { ...settingsRef.current, price_alerts_enabled: true, vest_alerts_enabled: true, capital_gains_alerts_enabled: true }
      setSettings(next)
      settingsRef.current = next
      await saveSettings(next)
    } catch (e: any) {
      console.error('Push subscribe failed:', e.message)
      setPushEnabled(false)
    } finally {
      setPushLoading(false)
    }
  }

  async function disablePush() {
    setPushEnabled(false)
    setPushLoading(true)
    try { await unsubscribeFromPush() } catch { setPushEnabled(true) } finally { setPushLoading(false) }
  }

  const keyLink = (href: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mne-link">
      Get key <ExternalLink size={11} aria-hidden="true" style={{ display: 'inline' }} />
    </a>
  )

  return (
    <div className="mne-main">
      <PageHead title="Settings" />
      <div style={{ display: 'grid', gap: 24, maxWidth: 760 }}>

        {/* API keys */}
        <section className="mne-card" aria-labelledby="settings-keys">
          <h2 id="settings-keys" className="mne-section-title">API keys</h2>
          <p className="mne-muted" style={{ margin: '0 0 12px' }}>
            Saved write-only on the server. They never come back to your browser.
          </p>
          {editingKeys ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="mne-form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <Field id="key-claude" label="Claude API key" help={<>{keyLink('https://console.anthropic.com/settings/keys')}</>}>
                  <input
                    id="key-claude"
                    className="mne-input"
                    type="password"
                    autoComplete="off"
                    placeholder={config.llmKeySet ? 'Saved. Enter a new key to replace it.' : 'sk-ant-...'}
                    value={keyDraft.claudeApiKey}
                    onChange={e => setKeyDraft(d => ({ ...d, claudeApiKey: e.target.value }))}
                  />
                </Field>
                <Field id="key-finnhub" label="Finnhub API key" help={<>{keyLink('https://finnhub.io/dashboard')}</>}>
                  <input
                    id="key-finnhub"
                    className="mne-input"
                    type="password"
                    autoComplete="off"
                    placeholder={config.hasFinnhubKey ? 'Saved. Enter a new key to replace it.' : 'your_key'}
                    value={keyDraft.finnhubApiKey}
                    onChange={e => setKeyDraft(d => ({ ...d, finnhubApiKey: e.target.value }))}
                  />
                </Field>
                <Field
                  id="key-coingecko"
                  label="CoinGecko API key (optional)"
                  help={<>Crypto prices work without one, but a free Demo key avoids CoinGecko's tight keyless rate limit and powers crypto price alerts. {keyLink('https://www.coingecko.com/en/api/pricing')}</>}
                >
                  <input
                    id="key-coingecko"
                    className="mne-input"
                    type="password"
                    autoComplete="off"
                    placeholder={config.coingeckoKeySet ? 'Saved. Enter a new key to replace it.' : 'CG-...'}
                    value={keyDraft.coingeckoApiKey}
                    onChange={e => setKeyDraft(d => ({ ...d, coingeckoApiKey: e.target.value }))}
                  />
                </Field>
              </div>
              {keyError && <span className="mne-help is-error" role="alert">▼ {keyError}</span>}
              <div className="mne-dialog-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="mne-btn" onClick={handleSaveKeys} disabled={keySaving}>
                  {keySaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="mne-btn is-ghost" onClick={() => { setEditingKeys(false); setKeyError('') }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mne-list">
              <div className="mne-row">
                <div>
                  <div className="t">Claude, Finnhub and CoinGecko</div>
                  <div className="d">
                    Claude {config.llmKeySet ? 'saved' : 'not set'} · Finnhub {config.hasFinnhubKey ? 'saved' : 'not set'} · CoinGecko {config.coingeckoKeySet ? 'saved' : 'optional'}
                  </div>
                </div>
                <button
                  type="button"
                  className="mne-btn is-ghost is-sm"
                  onClick={() => { setKeyDraft({ claudeApiKey: '', finnhubApiKey: '', coingeckoApiKey: '' }); setKeyError(''); setEditingKeys(true) }}
                >
                  Update API keys
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Appearance */}
        <section className="mne-card" aria-labelledby="settings-appearance">
          <h2 id="settings-appearance" className="mne-section-title">Appearance</h2>
          <div style={{ marginTop: 12 }}>
          <SegmentedControl<'light' | 'dark' | 'system'>
            label="Theme"
            value={theme}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
            onChange={handleThemeChange}
          />
          </div>
          <div className="mne-list" style={{ marginTop: 12 }}>
            <div className="mne-row">
              <div>
                <div className="t">Privacy mode</div>
                <div className="d">Blur dollar amounts on Home, Portfolio, and Charts</div>
              </div>
              <Switch label="Privacy mode" checked={hideValues} onChange={setHideValues} />
            </div>
          </div>
        </section>

        {/* AI */}
        <section className="mne-card" aria-labelledby="settings-ai">
          <h2 id="settings-ai" className="mne-section-title">AI</h2>
          <div className="mne-list">
            <div className="mne-row">
              <div>
                <div className="t">Auto-assign themes</div>
                <div className="d">Use AI to suggest themes when new tickers are created</div>
              </div>
              <Switch
                label="Auto-assign themes"
                checked={settings.auto_theme_assignment_enabled !== false}
                onChange={v => { void setAutoThemeAssignmentEnabled(v) }}
              />
            </div>
            <div className="mne-row">
              <div>
                <div className="t">Conversation history</div>
                <div className="d">View and continue past command bar conversations</div>
              </div>
              <button type="button" className="mne-btn is-ghost is-sm" onClick={openConversationHistory}>Open</button>
            </div>
          </div>
        </section>

        <Dialog
          open={showConversationHistory}
          onOpenChange={(open) => { if (!open) setShowConversationHistory(false) }}
        >
          <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Conversation History</DialogTitle>
            </DialogHeader>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {conversationsLoading && <p className="mne-muted">Loading…</p>}
              {conversationsError && <span className="mne-help is-error" role="alert">▼ {conversationsError}</span>}
              {!conversationsLoading && !conversationsError && conversations.length === 0 && (
                <p className="mne-muted">No conversations yet.</p>
              )}
              <div className="mne-list">
                {conversations.map(c => (
                  <div key={c.id} className="mne-row">
                    <button
                      type="button"
                      onClick={() => handleContinueConversation(c.id)}
                      style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
                    >
                      <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                      <div className="d">
                        {formatDateMDY(c.updated_at)}
                        {((c.total_input_tokens ?? 0) > 0 || (c.total_output_tokens ?? 0) > 0) && (
                          <span className="mne-num"> · {(c.total_input_tokens ?? 0).toLocaleString()} in · {(c.total_output_tokens ?? 0).toLocaleString()} out tokens</span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="mne-btn is-quiet is-sm"
                      onClick={() => void handleDeleteConversation(c.id)}
                      aria-label="Delete conversation"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Notifications */}
        <section className="mne-card" aria-labelledby="settings-notifications">
          <h2 id="settings-notifications" className="mne-section-title">Notifications</h2>
          <div className="mne-list">
            <div className="mne-row">
              <div>
                <div className="t">Push notifications</div>
                <div className="d">{pushEnabled ? 'Enabled' : 'Allow price and vest alerts'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pushToggleBusy && <Loader2 size={16} className="animate-spin mne-muted" aria-label="Updating" />}
                <Switch label="Push notifications" checked={pushEnabled} onChange={v => { void (v ? enablePush() : disablePush()) }} />
              </div>
            </div>
            {pushEnabled && (
              <>
                <div className="mne-row">
                  <div>
                    <div className="t">Price alerts</div>
                    <div className="d">Alert when a price moves by this %</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: settings.price_alerts_enabled ? 1 : 0.6 }}>
                    <input
                      className="mne-input mne-num"
                      type="number"
                      aria-label="Price alert threshold percent"
                      value={settings.price_alert_threshold}
                      onChange={e => setSettings(s => ({ ...s, price_alert_threshold: Number(e.target.value) }))}
                      onBlur={() => saveSettings(settingsRef.current)}
                      disabled={!settings.price_alerts_enabled}
                      style={{ width: 72, textAlign: 'right' }}
                    />
                    <span className="mne-muted">%</span>
                    <Switch label="Price alerts" checked={settings.price_alerts_enabled} onChange={v => { void setNotificationToggle('price_alerts_enabled', v) }} />
                  </div>
                </div>
                <div className="mne-row">
                  <div>
                    <div className="t">RSU vest reminders</div>
                    <div className="d">Days before a vest to notify</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: settings.vest_alerts_enabled ? 1 : 0.6 }}>
                    <input
                      className="mne-input mne-num"
                      type="number"
                      aria-label="Vest reminder days before"
                      value={settings.rsu_alert_days_before}
                      onChange={e => setSettings(s => ({ ...s, rsu_alert_days_before: Number(e.target.value) }))}
                      onBlur={() => saveSettings(settingsRef.current)}
                      disabled={!settings.vest_alerts_enabled}
                      style={{ width: 72, textAlign: 'right' }}
                    />
                    <span className="mne-muted">days</span>
                    <Switch label="RSU vest reminders" checked={settings.vest_alerts_enabled} onChange={v => { void setNotificationToggle('vest_alerts_enabled', v) }} />
                  </div>
                </div>
                <div className="mne-row">
                  <div>
                    <div className="t">Capital gains alerts</div>
                    <div className="d">Notify when Short Term lots are promoted to Long Term (after 1 year).</div>
                  </div>
                  <Switch label="Capital gains alerts" checked={settings.capital_gains_alerts_enabled} onChange={v => { void setNotificationToggle('capital_gains_alerts_enabled', v) }} />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Connected accounts */}
        <section className="mne-card" aria-labelledby="settings-plaid">
          <h2 id="settings-plaid" className="mne-section-title">Connected accounts</h2>
          <p className="mne-muted" style={{ margin: '0 0 12px' }}>
            Connect brokerages and banks through Plaid with your own free developer credentials.
          </p>
          {editingPlaidCreds ? (
            <div style={{ display: 'grid', gap: 16 }}>
              <p className="mne-muted" style={{ margin: 0 }}>
                Your own free Plaid developer credentials, not shared with other mne users. Get them at{' '}
                <a href="https://dashboard.plaid.com/team/keys" target="_blank" rel="noopener noreferrer" className="mne-link">dashboard.plaid.com</a>.
              </p>
              <div className="mne-form-grid">
                <Field id="plaid-client-id" label="Plaid client ID">
                  <input
                    id="plaid-client-id"
                    className="mne-input"
                    type="password"
                    autoComplete="off"
                    placeholder={plaidStatus.configured ? '•••••••• (unchanged)' : '66...'}
                    value={plaidCredsDraft.clientId}
                    onChange={e => setPlaidCredsDraft(d => ({ ...d, clientId: e.target.value }))}
                  />
                </Field>
                <Field id="plaid-secret" label="Plaid secret">
                  <input
                    id="plaid-secret"
                    className="mne-input"
                    type="password"
                    autoComplete="off"
                    placeholder={plaidStatus.configured ? '•••••••• (leave blank to keep current)' : 'production secret'}
                    value={plaidCredsDraft.secret}
                    onChange={e => setPlaidCredsDraft(d => ({ ...d, secret: e.target.value }))}
                  />
                </Field>
              </div>
              {plaidCredsError && <span className="mne-help is-error" role="alert">▼ {plaidCredsError}</span>}
              <div className="mne-dialog-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="mne-btn" onClick={handleSavePlaidCreds} disabled={plaidCredsSaving}>
                  {plaidCredsSaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="mne-btn is-ghost" onClick={() => { setEditingPlaidCreds(false); setPlaidCredsError('') }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mne-list">
              <div className="mne-row">
                <div>
                  <div className="t">{plaidStatus.configured ? 'Plaid credentials configured' : 'Set up Plaid credentials'}</div>
                  {!plaidStatus.configured && <div className="d">Required once, free. Connects accounts instead of manual entry.</div>}
                </div>
                <button
                  type="button"
                  className="mne-btn is-ghost is-sm"
                  onClick={() => { setPlaidCredsDraft({ clientId: '', secret: '' }); setPlaidCredsError(''); setEditingPlaidCreds(true) }}
                >
                  {plaidStatus.configured ? 'Edit' : 'Set up'}
                </button>
              </div>
            </div>
          )}

          {plaidStatus.configured && !editingPlaidCreds && (
            <div className="mne-list" style={{ marginTop: 4 }}>
              {plaidPendingCount > 0 && (
                <div className="mne-row">
                  <div>
                    <div className="t">Review {plaidPendingCount} synced position{plaidPendingCount !== 1 ? 's' : ''}</div>
                    <div className="d">Nothing is added to your portfolio until you confirm each one</div>
                  </div>
                  <button type="button" className="mne-btn is-sm" onClick={() => setPlaidReviewOpen(true)}>Review</button>
                </div>
              )}
              {plaidHeldSells.map(sell => (
                <div key={sell.id} className="mne-row">
                  <div>
                    <div className="t">Match lots for {sell.symbol ?? sell.assetName} sale</div>
                    <div className="d">Plaid shows {sell.quantity} {sell.isCrypto ? 'units' : 'shares'} sold on {sell.date}. Choose which lots they came from.</div>
                  </div>
                  <button type="button" className="mne-btn is-ghost is-sm" onClick={() => setPlaidMatchingSell(sell)}>Choose lots</button>
                </div>
              ))}
              {plaidDrift.map(pos => (
                <div key={pos.id} className="mne-row">
                  <div>
                    <div className="t">{pos.symbol ?? pos.assetName} differs from Plaid</div>
                    <div className="d">Plaid shows {pos.plaidQuantity} {pos.isCrypto ? 'units' : 'shares'}, {Math.abs(pos.driftShares)} {pos.driftShares > 0 ? 'more' : 'fewer'} than mne tracks</div>
                  </div>
                  <button
                    type="button"
                    className="mne-btn is-ghost is-sm"
                    disabled={plaidResolvingId === pos.id}
                    onClick={() => void handleResolvePlaidDrift(pos)}
                  >
                    {plaidResolvingId === pos.id ? 'Updating…' : 'Match Plaid'}
                  </button>
                </div>
              ))}
              {plaidItems.map(item => (
                <div key={item.id} className="mne-row">
                  <div>
                    <div className="t">{item.institution_name || 'Connected account'}</div>
                    <div className="d">
                      {item.status !== 'active'
                        ? `Needs attention${item.last_error ? `: ${item.last_error}` : ` (${item.status})`}`
                        : item.last_synced_at
                          ? `Last synced ${formatDateMDY(item.last_synced_at)}`
                          : 'Not yet synced'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mne-btn is-quiet is-sm"
                    disabled={plaidRemovingId === item.id}
                    onClick={() => void startDisconnectPlaidItem(item)}
                  >
                    {plaidRemovingId === item.id ? 'Removing…' : 'Disconnect'}
                  </button>
                </div>
              ))}
              <div className="mne-row">
                <div>
                  <div className="d">
                    {plaidItems.length >= PLAID_ITEM_LIMIT ? `Free-plan limit reached (${PLAID_ITEM_LIMIT}/${PLAID_ITEM_LIMIT})` : `${plaidItems.length}/${PLAID_ITEM_LIMIT} connected`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="mne-btn is-ghost is-sm"
                    disabled={plaidSyncing || plaidItems.length === 0}
                    onClick={() => void handleSyncPlaidNow()}
                  >
                    {plaidSyncing ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button
                    type="button"
                    className="mne-btn is-ghost is-sm"
                    disabled={plaidConnecting || plaidItems.length >= PLAID_ITEM_LIMIT}
                    onClick={() => void handleConnectPlaidAccount()}
                  >
                    {plaidConnecting ? 'Opening…' : 'Connect another account'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {plaidError && <span className="mne-help is-error" role="alert" style={{ display: 'block', marginTop: 8 }}>▼ {plaidError}</span>}
        </section>

        {plaidDisconnecting && (
          <PlaidDisconnectDialog
            institutionName={plaidDisconnecting.item.institution_name || 'this account'}
            assets={plaidDisconnecting.assets}
            busy={plaidRemovingId === plaidDisconnecting.item.id}
            onUnlink={() => void handleDisconnectPlaidItem(false)}
            onDelete={() => void handleDisconnectPlaidItem(true)}
            onCancel={() => setPlaidDisconnecting(null)}
          />
        )}
        <PlaidLotSellModal
          sell={plaidMatchingSell}
          onClose={() => setPlaidMatchingSell(null)}
          onChanged={() => void refreshPlaidData()}
        />
        <PlaidReviewModal
          open={plaidReviewOpen}
          onClose={() => setPlaidReviewOpen(false)}
          onChanged={() => void refreshPlaidData()}
        />

        {/* Data */}
        <section className="mne-card" aria-labelledby="settings-data">
          <h2 id="settings-data" className="mne-section-title">Data</h2>
          <p className="mne-muted" style={{ margin: '0 0 12px' }}>
            {importLoading ? 'Import in progress. Do not refresh or leave this page.' : 'Download a spreadsheet backup, or restore from one (.xlsx or .json).'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="mne-btn is-ghost" onClick={() => setExportDialogOpen(true)}>Export</button>
            <button type="button" className="mne-btn is-ghost" disabled={importLoading} onClick={() => fileInputRef.current?.click()}>
              {importLoading ? 'Importing…' : 'Import'}
            </button>
            {importLoading && <Loader2 size={16} className="animate-spin mne-muted" style={{ alignSelf: 'center' }} aria-hidden="true" />}
          </div>
          <input
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleImportFile(f)
            }}
          />
        </section>

        <Dialog open={exportDialogOpen} onOpenChange={(open) => { if (!exportingScope) setExportDialogOpen(open) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Export data</DialogTitle>
            </DialogHeader>
            <p className="mne-muted" style={{ margin: 0 }}>Choose what to include in the spreadsheet.</p>
            <div style={{ display: 'grid', gap: 8, paddingTop: 4 }}>
              {([
                { scope: 'all' as const, label: 'All data', busy: 'Exporting…', hint: 'Net worth history, AI conversation history, and all asset details' },
                { scope: 'assets' as const, label: 'Only assets', busy: 'Exporting…', hint: 'Only your asset, account, and transaction details' },
              ]).map(o => (
                <button
                  key={o.scope}
                  type="button"
                  className="mne-item"
                  disabled={!!exportingScope}
                  onClick={() => void handleExport(o.scope)}
                  style={{ border: 0, textAlign: 'left', cursor: exportingScope ? 'default' : 'pointer', color: 'inherit', font: 'inherit' }}
                >
                  <div className="mne-item-head">
                    <b>{exportingScope === o.scope ? o.busy : o.label}</b>
                    {exportingScope === o.scope && <Loader2 size={14} className="animate-spin mne-muted" aria-hidden="true" />}
                  </div>
                  <span className="mne-help">{o.hint}</span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Admin */}
        {isAdmin && (
          <section className="mne-card" aria-labelledby="settings-admin">
            <h2 id="settings-admin" className="mne-section-title">Allowed users</h2>
            <p className="mne-muted" style={{ margin: '0 0 12px' }}>Only these emails can sign up.</p>
            {allowedEmails.length > 0 ? (
              <div className="mne-list">
                {allowedEmails.map(e => (
                  <div key={e.id} className="mne-row">
                    <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        className={`mne-chip ${e.is_admin ? 'is-accent' : 'is-outline'}`}
                        aria-pressed={e.is_admin}
                        onClick={() => void handleToggleAdmin(e.id, !e.is_admin)}
                        title={e.is_admin ? 'Remove admin' : 'Make admin'}
                        style={{ cursor: 'pointer' }}
                      >
                        Admin
                      </button>
                      <button type="button" className="mne-btn is-quiet is-sm" onClick={() => void handleRemoveAllowedEmail(e.id)} aria-label={`Remove ${e.email}`}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mne-muted" style={{ margin: 0 }}>No allowed emails yet.</p>
            )}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 }}>
              <div className="mne-field" style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="allowed-email">Add an email</label>
                <input
                  id="allowed-email"
                  className="mne-input"
                  type="email"
                  placeholder="user@example.com"
                  value={newAllowedEmail}
                  onChange={e => setNewAllowedEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleAddAllowedEmail() }}
                />
              </div>
              <label className="mne-check" style={{ paddingBottom: 10 }}>
                <input type="checkbox" checked={newAllowedEmailIsAdmin} onChange={e => setNewAllowedEmailIsAdmin(e.target.checked)} />
                <span>Admin</span>
              </label>
              <button type="button" className="mne-btn" onClick={() => void handleAddAllowedEmail()} disabled={allowlistLoading || !newAllowedEmail.trim()}>
                {allowlistLoading ? 'Adding…' : 'Add'}
              </button>
            </div>
            {allowlistError && <span className="mne-help is-error" role="alert" style={{ display: 'block', marginTop: 8 }}>▼ {allowlistError}</span>}
          </section>
        )}

        {/* Account */}
        <section className="mne-card" aria-labelledby="settings-account">
          <h2 id="settings-account" className="mne-section-title">Account</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="mne-btn is-quiet" onClick={handleSignOut}>Sign out</button>
          </div>
        </section>
      </div>
    </div>
  )
}
