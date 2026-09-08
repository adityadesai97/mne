// src/pages/Settings.tsx
import { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/db/settings'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { config } from '@/store/config'
import type { LLMProvider } from '@/store/config'
import { exportData, importData, setActiveImportController, type ExportScope } from '@/lib/importExport'
import { subscribeToPush, unsubscribeFromPush, getPushEnabled } from '@/lib/pushNotifications'
import { getSupabaseClient } from '@/lib/supabase'
import { applyTheme } from '@/lib/theme'
import { useHideValues } from '@/hooks/useHideValues'
import { listConversations, deleteConversation, type ConversationSummary } from '@/lib/db/conversations'
import { resumeConversationInCommandBar } from '@/lib/commandBarBridge'
import { formatDateMDY } from '@/lib/dates'
import { ChevronRight, Bell, Database, LogOut, Key, Sun, ExternalLink, Loader2, Sparkles, Info, Shield, Trash2, Plus, Link2 } from 'lucide-react'
import {
  getPlaidCredentialsStatus,
  savePlaidCredentials,
  listPlaidItems,
  removePlaidItem,
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  syncPlaidNow,
  getPendingPlaidPositionsCount,
  PLAID_ITEM_LIMIT,
  type PlaidItem,
} from '@/lib/db/plaid'
import { openPlaidLink } from '@/lib/plaidLink'
import { showAppAlert } from '@/lib/appAlerts'
import { PlaidReviewModal } from '@/components/PlaidReviewModal'

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-foreground/70 px-1 mb-2 mt-14 first:mt-0">
      {children}
    </p>
  )
}

function Row({ label, hint, right, onClick, destructive, disabled }: {
  label: string
  hint?: string
  right?: React.ReactNode
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  const cls = `flex items-center gap-3 px-4 py-4 bg-card rounded-xl ${onClick && !disabled ? 'cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors' : ''} ${disabled ? 'opacity-80' : ''}`
  return (
    <div className={cls} onClick={onClick && !disabled ? onClick : undefined}>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${destructive ? 'text-destructive' : ''}`}>{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {right}
      {onClick && !right && <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />}
    </div>
  )
}


function Toggle({ enabled, onEnable, onDisable }: { enabled: boolean; onEnable: () => void; onDisable: () => void }) {
  return (
    <button
      type="button"
      onClick={enabled ? onDisable : onEnable}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer ${enabled ? 'bg-primary' : 'bg-muted'}`}
      aria-pressed={enabled}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function ThemePicker({ value, onChange }: { value: 'light' | 'dark' | 'system'; onChange: (v: 'light' | 'dark' | 'system') => void }) {
  const options: { v: 'light' | 'dark' | 'system'; label: string }[] = [
    { v: 'light', label: 'Light' },
    { v: 'dark', label: 'Dark' },
    { v: 'system', label: 'System' },
  ]
  return (
    <div className="flex gap-1 bg-muted/60 rounded-lg p-1">
      {options.map(opt => (
        <button
          key={opt.v}
          type="button"
          onClick={() => onChange(opt.v)}
          className={`flex-1 text-xs py-1 rounded-md transition-colors ${value === opt.v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Hint({ text }: { text: string }) {
  return (
    <div className="relative group/hint inline-flex items-center">
      <Info size={11} className="text-muted-foreground/40 cursor-help" />
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 rounded-md bg-popover border border-border text-popover-foreground text-[11px] whitespace-nowrap shadow-md opacity-0 group-hover/hint:opacity-100 transition-opacity pointer-events-none z-50">
        {text}
      </div>
    </div>
  )
}

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
  const [keyDraft, setKeyDraft] = useState({ claudeApiKey: '', groqApiKey: '', finnhubApiKey: '' })
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [providerWarning, setProviderWarning] = useState('')
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
  const [plaidReviewOpen, setPlaidReviewOpen] = useState(false)
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

  function handleProviderChange(p: LLMProvider) {
    const keyForProvider = p === 'claude' ? config.claudeApiKey : config.groqApiKey
    if (!keyForProvider) {
      const name = p === 'claude' ? 'Claude' : 'Groq'
      setProviderWarning(`Add a ${name} API key in API Keys first.`)
      return
    }
    setProviderWarning('')
    config.setLLMProvider(p)
    saveSettings({ llm_provider: p }).catch(console.error)
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
    const mergedClaude  = keyDraft.claudeApiKey  || config.claudeApiKey
    const mergedGroq    = keyDraft.groqApiKey    || config.groqApiKey
    const mergedFinnhub = keyDraft.finnhubApiKey || config.finnhubApiKey
    if (!mergedFinnhub) { setKeyError('Finnhub API key is required'); return }
    if (!mergedClaude && !mergedGroq) { setKeyError('At least one AI provider key is required'); return }
    setKeySaving(true)
    setKeyError('')
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) { setKeyError('Not authenticated'); return }
      const dbRow: Record<string, string> = { user_id: user.id, finnhub_api_key: mergedFinnhub }
      if (keyDraft.claudeApiKey) dbRow.claude_api_key = keyDraft.claudeApiKey
      if (keyDraft.groqApiKey)   dbRow.groq_api_key   = keyDraft.groqApiKey
      await saveSettings(dbRow)
      config.save({
        claudeApiKey:  keyDraft.claudeApiKey  || config.claudeApiKey,
        groqApiKey:    keyDraft.groqApiKey    || config.groqApiKey,
        finnhubApiKey: mergedFinnhub,
      })
      setEditingKeys(false)
    } catch (e: any) {
      setKeyError(e.message ?? 'Failed to save')
    } finally {
      setKeySaving(false)
    }
  }

  async function refreshPlaidData() {
    try {
      const [status, items, pendingCount] = await Promise.all([
        getPlaidCredentialsStatus(),
        listPlaidItems(),
        getPendingPlaidPositionsCount(),
      ])
      setPlaidStatus(status)
      setPlaidItems(items)
      setPlaidPendingCount(pendingCount)
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

  async function handleRemovePlaidItem(id: string) {
    setPlaidRemovingId(id)
    try {
      await removePlaidItem(id)
      await refreshPlaidData()
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

  return (
    <div className="pt-6 pb-8 px-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-5">Settings</h1>

      {/* Appearance */}
      <SectionHeader><Sun size={10} className="inline mr-1.5 mb-0.5" />Appearance</SectionHeader>
      <div className="space-y-2">
        <div className="bg-card rounded-xl px-4 py-4 space-y-2">
          <p className="text-sm font-medium">Theme</p>
          <ThemePicker value={theme} onChange={handleThemeChange} />
        </div>
        <div className="flex items-center gap-3 px-4 py-4 bg-card rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Privacy mode</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Blur dollar amounts on Home, Portfolio, and Charts
            </p>
          </div>
          <Toggle
            enabled={hideValues}
            onEnable={() => setHideValues(true)}
            onDisable={() => setHideValues(false)}
          />
        </div>
      </div>

      {/* AI */}
      <SectionHeader><Sparkles size={10} className="inline mr-1.5 mb-0.5" />AI</SectionHeader>
      <div className="space-y-2">
        {/* AI Provider picker */}
        <div className="bg-card rounded-xl px-4 py-4 space-y-2">
          <p className="text-sm font-medium">AI Provider</p>
          <div className="flex gap-1 bg-muted/60 rounded-lg p-1">
            {(['claude', 'groq'] as LLMProvider[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handleProviderChange(p)}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${config.llmProvider === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {p === 'claude' ? 'Claude' : 'Groq'}
              </button>
            ))}
          </div>
          {providerWarning && <p className="text-xs text-amber-500">{providerWarning}</p>}
        </div>
        <div className="flex items-center gap-3 px-4 py-4 bg-card rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Auto-assign themes</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Use AI to suggest themes when new tickers are created
            </p>
          </div>
          <Toggle
            enabled={settings.auto_theme_assignment_enabled !== false}
            onEnable={() => { void setAutoThemeAssignmentEnabled(true) }}
            onDisable={() => { void setAutoThemeAssignmentEnabled(false) }}
          />
        </div>
        <Row
          label="Conversation History"
          hint="View and continue past command bar conversations"
          onClick={openConversationHistory}
        />
      </div>

      <Dialog
        open={showConversationHistory}
        onOpenChange={(open) => { if (!open) setShowConversationHistory(false) }}
      >
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Conversation History</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1">
            {conversationsLoading && (
              <p className="text-xs text-muted-foreground px-2 py-2">Loading…</p>
            )}
            {conversationsError && (
              <p className="text-xs text-destructive px-2 py-1">{conversationsError}</p>
            )}
            {!conversationsLoading && !conversationsError && conversations.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-2">No conversations yet.</p>
            )}
            {conversations.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                <button
                  type="button"
                  onClick={() => handleContinueConversation(c.id)}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <p className="text-sm font-medium truncate">{c.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDateMDY(c.updated_at)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteConversation(c.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 p-1"
                  aria-label="Delete conversation"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Notifications */}
      <SectionHeader><Bell size={10} className="inline mr-1.5 mb-0.5" />Notifications</SectionHeader>
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-4 py-4 bg-card rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Push notifications</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {pushEnabled ? 'Enabled' : 'Allow price and vest alerts'}
            </p>
          </div>
          {pushLoading && (
            <svg className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          <Toggle
            enabled={pushEnabled}
            onEnable={async () => {
              setPushEnabled(true)
              setPushLoading(true)
              try {
                await subscribeToPush()
                const next = { ...settingsRef.current, price_alerts_enabled: true, vest_alerts_enabled: true, capital_gains_alerts_enabled: true }
                setSettings(next)
                settingsRef.current = next
                await saveSettings(next)
              }
              catch (e: any) { console.error('Push subscribe failed:', e.message); setPushEnabled(false) }
              finally { setPushLoading(false) }
            }}
            onDisable={async () => {
              setPushEnabled(false)
              setPushLoading(true)
              try { await unsubscribeFromPush() }
              catch { setPushEnabled(true) }
              finally { setPushLoading(false) }
            }}
          />
        </div>

        {pushEnabled && (
          <div className="ml-3 pl-3 border-l-2 border-border/40 space-y-1.5">
            {/* Price alerts */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-card rounded-xl">
              <div className="flex items-center gap-1 flex-shrink-0">
                <p className="text-sm font-medium">Price alerts</p>
                <Hint text="Alert when price moves by this %" />
              </div>
              <div className={`flex items-center gap-1.5 ml-auto transition-opacity ${settings.price_alerts_enabled ? '' : 'opacity-35'}`}>
                <Input
                  type="number"
                  value={settings.price_alert_threshold}
                  onChange={e => setSettings(s => ({ ...s, price_alert_threshold: Number(e.target.value) }))}
                  onBlur={() => saveSettings(settingsRef.current)}
                  disabled={!settings.price_alerts_enabled}
                  className="w-14 h-7 text-sm text-right border-border/60 bg-muted/40 px-2"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <Toggle
                enabled={settings.price_alerts_enabled}
                onEnable={() => { void setNotificationToggle('price_alerts_enabled', true) }}
                onDisable={() => { void setNotificationToggle('price_alerts_enabled', false) }}
              />
            </div>

            {/* RSU vest reminders */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-card rounded-xl">
              <div className="flex items-center gap-1 flex-shrink-0">
                <p className="text-sm font-medium">RSU vest reminders</p>
                <Hint text="Days before vest end to notify" />
              </div>
              <div className={`flex items-center gap-1.5 ml-auto transition-opacity ${settings.vest_alerts_enabled ? '' : 'opacity-35'}`}>
                <Input
                  type="number"
                  value={settings.rsu_alert_days_before}
                  onChange={e => setSettings(s => ({ ...s, rsu_alert_days_before: Number(e.target.value) }))}
                  onBlur={() => saveSettings(settingsRef.current)}
                  disabled={!settings.vest_alerts_enabled}
                  className="w-14 h-7 text-sm text-right border-border/60 bg-muted/40 px-2"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
              <Toggle
                enabled={settings.vest_alerts_enabled}
                onEnable={() => { void setNotificationToggle('vest_alerts_enabled', true) }}
                onDisable={() => { void setNotificationToggle('vest_alerts_enabled', false) }}
              />
            </div>

            {/* Capital gains alerts */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-card rounded-xl">
              <div className="flex items-center gap-1 flex-shrink-0">
                <p className="text-sm font-medium">Capital gains alerts</p>
                <Hint text="Notify when Short Term lots are promoted to Long Term (after 1 year)." />
              </div>
              <div className="ml-auto" />
              <Toggle
                enabled={settings.capital_gains_alerts_enabled}
                onEnable={() => { void setNotificationToggle('capital_gains_alerts_enabled', true) }}
                onDisable={() => { void setNotificationToggle('capital_gains_alerts_enabled', false) }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Data */}
      <SectionHeader><Database size={10} className="inline mr-1.5 mb-0.5" />Data</SectionHeader>
      <div className="space-y-2">
        <Row label="Export" hint="Download a spreadsheet backup of your portfolio" onClick={() => setExportDialogOpen(true)} />
        <Row
          label={importLoading ? 'Importing…' : 'Import'}
          hint={importLoading ? 'Import in progress. Do not refresh or leave this page.' : 'Restore from a backup (.xlsx or .json)'}
          right={importLoading ? <Loader2 size={14} className="text-muted-foreground animate-spin flex-shrink-0" /> : undefined}
          disabled={importLoading}
          onClick={() => fileInputRef.current?.click()}
        />
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
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={(open) => { if (!exportingScope) setExportDialogOpen(open) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export data</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">Choose what to include in the spreadsheet.</p>
          <div className="space-y-2 pt-1">
            <Row
              label={exportingScope === 'all' ? 'Exporting…' : 'All data'}
              hint="Net worth history, AI conversation history, and all asset details"
              right={exportingScope === 'all' ? <Loader2 size={14} className="text-muted-foreground animate-spin flex-shrink-0" /> : undefined}
              disabled={!!exportingScope}
              onClick={() => void handleExport('all')}
            />
            <Row
              label={exportingScope === 'assets' ? 'Exporting…' : 'Only assets'}
              hint="Only your asset, account, and transaction details"
              right={exportingScope === 'assets' ? <Loader2 size={14} className="text-muted-foreground animate-spin flex-shrink-0" /> : undefined}
              disabled={!!exportingScope}
              onClick={() => void handleExport('assets')}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* API Keys */}
      <SectionHeader><Key size={10} className="inline mr-1.5 mb-0.5" />API Keys</SectionHeader>
      {editingKeys ? (
        <div className="bg-card rounded-xl p-4 space-y-3 animate-slideDown">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Claude API Key</label>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors">
                Get key <ExternalLink size={9} />
              </a>
            </div>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyDraft.claudeApiKey}
              onChange={e => setKeyDraft(d => ({ ...d, claudeApiKey: e.target.value }))}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Groq API Key</label>
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors">
                Get key <ExternalLink size={9} />
              </a>
            </div>
            <input
              type="password"
              placeholder="gsk_..."
              value={keyDraft.groqApiKey}
              onChange={e => setKeyDraft(d => ({ ...d, groqApiKey: e.target.value }))}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Finnhub API Key</label>
              <a href="https://finnhub.io/dashboard" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors">
                Get key <ExternalLink size={9} />
              </a>
            </div>
            <input
              type="password"
              placeholder="your_key"
              value={keyDraft.finnhubApiKey}
              onChange={e => setKeyDraft(d => ({ ...d, finnhubApiKey: e.target.value }))}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          {keyError && <p className="text-xs text-destructive">{keyError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSaveKeys}
              disabled={keySaving}
              className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {keySaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditingKeys(false); setKeyError('') }}
              className="flex-1 bg-muted text-muted-foreground rounded-lg py-2 text-sm hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden">
          <div
            className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => { setKeyDraft({ claudeApiKey: '', groqApiKey: '', finnhubApiKey: '' }); setKeyError(''); setEditingKeys(true) }}
          >
            <p className="text-sm font-medium flex-1">Update API keys</p>
            <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
          </div>
        </div>
      )}

      {/* Plaid */}
      <SectionHeader><Link2 size={10} className="inline mr-1.5 mb-0.5" />Connected Accounts (Plaid)</SectionHeader>
      {editingPlaidCreds ? (
        <div className="bg-card rounded-xl p-4 space-y-3 animate-slideDown">
          <p className="text-[11px] text-muted-foreground">
            Your own free Plaid developer credentials — not shared with other mne users. Get them at{' '}
            <a href="https://dashboard.plaid.com/team/keys" target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:text-primary underline underline-offset-2">
              dashboard.plaid.com
            </a>.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plaid Client ID</label>
            <input
              type="password"
              placeholder={plaidStatus.configured ? '•••••••• (unchanged)' : '66...'}
              value={plaidCredsDraft.clientId}
              onChange={e => setPlaidCredsDraft(d => ({ ...d, clientId: e.target.value }))}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plaid Secret</label>
            <input
              type="password"
              placeholder={plaidStatus.configured ? '•••••••• (leave blank to keep current)' : 'production secret'}
              value={plaidCredsDraft.secret}
              onChange={e => setPlaidCredsDraft(d => ({ ...d, secret: e.target.value }))}
              className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            />
          </div>
          {plaidCredsError && <p className="text-xs text-destructive">{plaidCredsError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSavePlaidCreds}
              disabled={plaidCredsSaving}
              className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {plaidCredsSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditingPlaidCreds(false); setPlaidCredsError('') }}
              className="flex-1 bg-muted text-muted-foreground rounded-lg py-2 text-sm hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden">
          <Row
            label={plaidStatus.configured ? 'Plaid credentials configured' : 'Set up Plaid credentials'}
            hint={plaidStatus.configured ? undefined : 'Required once, free — connects accounts instead of manual entry'}
            onClick={() => { setPlaidCredsDraft({ clientId: '', secret: '' }); setPlaidCredsError(''); setEditingPlaidCreds(true) }}
          />
        </div>
      )}

      {plaidStatus.configured && (
        <div className="bg-card rounded-xl overflow-hidden mt-2 divide-y divide-border/60">
          {plaidPendingCount > 0 && (
            <Row
              label={`Review ${plaidPendingCount} synced position${plaidPendingCount !== 1 ? 's' : ''}`}
              hint="Nothing is added to your portfolio until you confirm each one"
              onClick={() => setPlaidReviewOpen(true)}
            />
          )}
          {plaidItems.map(item => (
            <Row
              key={item.id}
              label={item.institution_name || 'Connected account'}
              hint={
                item.status !== 'active'
                  ? `Needs attention (${item.status})`
                  : item.last_synced_at
                    ? `Last synced ${formatDateMDY(item.last_synced_at)}`
                    : 'Not yet synced'
              }
              right={
                <button
                  type="button"
                  disabled={plaidRemovingId === item.id}
                  onClick={() => void handleRemovePlaidItem(item.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 text-xs disabled:opacity-50"
                >
                  {plaidRemovingId === item.id ? 'Removing…' : 'Disconnect'}
                </button>
              }
            />
          ))}
          <Row
            label={plaidConnecting ? 'Opening…' : 'Connect another account'}
            hint={plaidItems.length >= PLAID_ITEM_LIMIT ? `Free-plan limit reached (${PLAID_ITEM_LIMIT}/${PLAID_ITEM_LIMIT})` : `${plaidItems.length}/${PLAID_ITEM_LIMIT} connected`}
            disabled={plaidConnecting || plaidItems.length >= PLAID_ITEM_LIMIT}
            onClick={() => void handleConnectPlaidAccount()}
          />
          <Row
            label={plaidSyncing ? 'Syncing…' : 'Sync now'}
            disabled={plaidSyncing || plaidItems.length === 0}
            onClick={() => void handleSyncPlaidNow()}
          />
        </div>
      )}
      {plaidError && <p className="text-xs text-destructive mt-2 px-1">{plaidError}</p>}
      <PlaidReviewModal
        open={plaidReviewOpen}
        onClose={() => setPlaidReviewOpen(false)}
        onChanged={() => void refreshPlaidData()}
      />

      {/* Admin */}
      {isAdmin && (
        <>
          <SectionHeader><Shield size={10} className="inline mr-1.5 mb-0.5" />Admin — Allowed Users</SectionHeader>
          <div className="bg-card rounded-xl p-4 space-y-3">
            {allowedEmails.length > 0 && (
              <div className="space-y-1">
                {allowedEmails.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-1 py-1">
                    <span className="text-sm flex-1 truncate">{e.email}</span>
                    <button
                      type="button"
                      onClick={() => void handleToggleAdmin(e.id, !e.is_admin)}
                      className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors flex-shrink-0 ${e.is_admin ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                      title={e.is_admin ? 'Remove admin' : 'Make admin'}
                    >
                      Admin
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveAllowedEmail(e.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      aria-label="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {allowedEmails.length === 0 && (
              <p className="text-xs text-muted-foreground">No allowed emails yet.</p>
            )}
            <div className="flex gap-2 pt-1">
              <input
                type="email"
                placeholder="user@example.com"
                value={newAllowedEmail}
                onChange={e => setNewAllowedEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleAddAllowedEmail() }}
                className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newAllowedEmailIsAdmin}
                  onChange={e => setNewAllowedEmailIsAdmin(e.target.checked)}
                  className="accent-primary"
                />
                Admin
              </label>
              <button
                type="button"
                onClick={() => void handleAddAllowedEmail()}
                disabled={allowlistLoading || !newAllowedEmail.trim()}
                className="flex items-center gap-1 bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {allowlistLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Add
              </button>
            </div>
            {allowlistError && <p className="text-xs text-destructive">{allowlistError}</p>}
          </div>
        </>
      )}

      {/* Account */}
      <SectionHeader><LogOut size={10} className="inline mr-1.5 mb-0.5" />Account</SectionHeader>
      <div className="space-y-2">
        <Row label="Sign out" onClick={handleSignOut} destructive />
      </div>
    </div>
  )
}
