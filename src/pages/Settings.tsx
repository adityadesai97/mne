// src/pages/Settings.tsx
import { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/db/settings'
import { Input } from '@/components/ui/input'
import { config } from '@/store/config'
import { exportData, importData, setActiveImportController } from '@/lib/importExport'
import { subscribeToPush, unsubscribeFromPush, getPushEnabled } from '@/lib/pushNotifications'
import { getSupabaseClient } from '@/lib/supabase'
import { applyTheme } from '@/lib/theme'
import { ChevronRight, Bell, Database, LogOut, Key, Sun, ExternalLink, Loader2, Sparkles } from 'lucide-react'

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

export default function Settings() {
  const [settings, setSettings] = useState({
    price_alert_threshold: 5,
    tax_harvest_threshold: 1000,
    rsu_alert_days_before: 7,
    auto_theme_assignment_enabled: true,
    price_alerts_enabled: true,
    vest_alerts_enabled: true,
    capital_gains_alerts_enabled: true,
  })
  const HOME_CHART_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const
  type HomeChartRange = typeof HOME_CHART_RANGES[number]
  const [homeChartRange, setHomeChartRangeState] = useState<HomeChartRange>(
    () => (localStorage.getItem('mne_home_chart_range') as HomeChartRange) ?? '1Y'
  )
  function handleHomeChartRangeChange(v: HomeChartRange) {
    localStorage.setItem('mne_home_chart_range', v)
    setHomeChartRangeState(v)
  }

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(config.theme)
  const [editingKeys, setEditingKeys] = useState(false)
  const [keyDraft, setKeyDraft] = useState({ claudeApiKey: '', finnhubApiKey: '' })
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [importLoading, setImportLoading] = useState(false)
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
    if (!keyDraft.claudeApiKey || !keyDraft.finnhubApiKey) { setKeyError('Both fields are required'); return }
    setKeySaving(true)
    setKeyError('')
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) { setKeyError('Not authenticated'); return }
      await saveSettings({ user_id: user.id, claude_api_key: keyDraft.claudeApiKey, finnhub_api_key: keyDraft.finnhubApiKey })
      config.save(keyDraft)
      setEditingKeys(false)
    } catch (e: any) {
      setKeyError(e.message ?? 'Failed to save')
    } finally {
      setKeySaving(false)
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
            <p className="text-sm font-medium">Home chart range</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Time window shown in the net worth chart</p>
          </div>
          <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-1">
            {HOME_CHART_RANGES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => handleHomeChartRangeChange(r)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${homeChartRange === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI */}
      <SectionHeader><Sparkles size={10} className="inline mr-1.5 mb-0.5" />AI</SectionHeader>
      <div className="space-y-2">
        <div className="flex items-center gap-3 px-4 py-4 bg-card rounded-xl">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Auto-assign themes</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Use Claude to suggest themes when new tickers are created
            </p>
          </div>
          <Toggle
            enabled={settings.auto_theme_assignment_enabled !== false}
            onEnable={() => { void setAutoThemeAssignmentEnabled(true) }}
            onDisable={() => { void setAutoThemeAssignmentEnabled(false) }}
          />
        </div>
      </div>

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
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Price alerts</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Alert when price moves by this %</p>
              </div>
              <div className={`flex items-center gap-1.5 transition-opacity ${settings.price_alerts_enabled ? '' : 'opacity-35'}`}>
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
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">RSU vest reminders</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Days before vest end to notify</p>
              </div>
              <div className={`flex items-center gap-1.5 transition-opacity ${settings.vest_alerts_enabled ? '' : 'opacity-35'}`}>
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
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Capital gains alerts</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Alert when loss exceeds this amount</p>
              </div>
              <div className={`flex items-center gap-1.5 transition-opacity ${settings.capital_gains_alerts_enabled ? '' : 'opacity-35'}`}>
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={settings.tax_harvest_threshold}
                  onChange={e => setSettings(s => ({ ...s, tax_harvest_threshold: Number(e.target.value) }))}
                  onBlur={() => saveSettings(settingsRef.current)}
                  disabled={!settings.capital_gains_alerts_enabled}
                  className="w-18 h-7 text-sm text-right border-border/60 bg-muted/40 px-2"
                />
              </div>
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
        <Row label="Export data as JSON" onClick={exportData} />
        <Row
          label={importLoading ? 'Importing JSON…' : 'Import from JSON'}
          hint={importLoading ? 'Import in progress. Do not refresh or leave this page.' : undefined}
          right={importLoading ? <Loader2 size={14} className="text-muted-foreground animate-spin flex-shrink-0" /> : undefined}
          disabled={importLoading}
          onClick={() => fileInputRef.current?.click()}
        />
        <input
          id="import-file"
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void handleImportFile(f)
          }}
        />
      </div>

      {/* API Keys */}
      <SectionHeader><Key size={10} className="inline mr-1.5 mb-0.5" />API Keys</SectionHeader>
      {editingKeys ? (
        <div className="bg-card rounded-xl p-4 space-y-3">
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
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Claude</p>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors mt-0.5 w-fit">
                Get key <ExternalLink size={9} />
              </a>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{config.claudeApiKey ? '••••••••' : 'Not set'}</span>
          </div>
          <div className="h-px bg-border mx-4" />
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Finnhub</p>
              <a href="https://finnhub.io/dashboard" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors mt-0.5 w-fit">
                Get key <ExternalLink size={9} />
              </a>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{config.finnhubApiKey ? '••••••••' : 'Not set'}</span>
          </div>
          <div className="h-px bg-border mx-4" />
          <div
            className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-muted/40 transition-colors"
            onClick={() => { setKeyDraft({ claudeApiKey: '', finnhubApiKey: '' }); setKeyError(''); setEditingKeys(true) }}
          >
            <p className="text-sm font-medium flex-1">Update API keys</p>
            <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
          </div>
        </div>
      )}

      {/* Account */}
      <SectionHeader><LogOut size={10} className="inline mr-1.5 mb-0.5" />Account</SectionHeader>
      <div className="space-y-2">
        <Row label="Sign out" onClick={handleSignOut} destructive />
      </div>
    </div>
  )
}
