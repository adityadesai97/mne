// src/pages/Settings.tsx
import { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/db/settings'
import { Input } from '@/components/ui/input'
import { config } from '@/store/config'
import { exportData, importData } from '@/lib/importExport'
import { subscribeToPush, unsubscribeFromPush, getPushEnabled } from '@/lib/pushNotifications'
import { getSupabaseClient } from '@/lib/supabase'
import { applyTheme } from '@/lib/theme'
import { ChevronRight, Bell, Database, LogOut, Key, Sun, ExternalLink } from 'lucide-react'

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-foreground/70 px-1 mb-2 mt-14 first:mt-0">
      {children}
    </p>
  )
}

function Row({ label, hint, right, onClick, destructive }: {
  label: string
  hint?: string
  right?: React.ReactNode
  onClick?: () => void
  destructive?: boolean
}) {
  const cls = `flex items-center gap-3 px-4 py-4 bg-card rounded-xl ${onClick ? 'cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-colors' : ''}`
  return (
    <div className={cls} onClick={onClick}>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${destructive ? 'text-destructive' : ''}`}>{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {right}
      {onClick && !right && <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />}
    </div>
  )
}

function NumberRow({ label, hint, value, onChange, onBlur }: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  onBlur: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-4 bg-card rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onBlur={onBlur}
        className="w-20 h-7 text-sm text-right border-border/60 bg-muted/40 px-2"
      />
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
  })
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(config.theme)
  const [editingKeys, setEditingKeys] = useState(false)
  const [keyDraft, setKeyDraft] = useState({ claudeApiKey: '', finnhubApiKey: '' })
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState('')
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => {
    getSettings().then(s => { if (s) setSettings(s as any) }).catch(console.error)
    getPushEnabled().then(setPushEnabled)
  }, [])

  function handleThemeChange(v: 'light' | 'dark' | 'system') {
    config.setTheme(v)
    applyTheme(v)
    setThemeState(v)
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
    window.location.reload()
  }

  return (
    <div className="pt-6 pb-8 px-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-5">Settings</h1>

      {/* Appearance */}
      <SectionHeader><Sun size={10} className="inline mr-1.5 mb-0.5" />Appearance</SectionHeader>
      <div className="bg-card rounded-xl px-4 py-4 space-y-2">
        <p className="text-sm font-medium">Theme</p>
        <ThemePicker value={theme} onChange={handleThemeChange} />
      </div>

      {/* Notifications */}
      <SectionHeader><Bell size={10} className="inline mr-1.5 mb-0.5" />Notifications</SectionHeader>
      <div className="space-y-2">
        {pushEnabled && (
          <>
            <NumberRow
              label="Price alert threshold"
              hint="Alert when price moves by this %"
              value={settings.price_alert_threshold}
              onChange={v => setSettings(s => ({ ...s, price_alert_threshold: v }))}
              onBlur={() => saveSettings(settingsRef.current)}
            />
            <NumberRow
              label="Tax harvest threshold"
              hint="Alert when loss exceeds this amount ($)"
              value={settings.tax_harvest_threshold}
              onChange={v => setSettings(s => ({ ...s, tax_harvest_threshold: v }))}
              onBlur={() => saveSettings(settingsRef.current)}
            />
            <NumberRow
              label="RSU vest reminder"
              hint="Days before vest end to notify"
              value={settings.rsu_alert_days_before}
              onChange={v => setSettings(s => ({ ...s, rsu_alert_days_before: v }))}
              onBlur={() => saveSettings(settingsRef.current)}
            />
          </>
        )}
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
              } catch (e: any) {
                console.error('Push subscribe failed:', e.message)
                setPushEnabled(false)
              } finally {
                setPushLoading(false)
              }
            }}
            onDisable={async () => {
              setPushEnabled(false)
              setPushLoading(true)
              try {
                await unsubscribeFromPush()
              } catch {
                setPushEnabled(true)
              } finally {
                setPushLoading(false)
              }
            }}
          />
        </div>
      </div>

      {/* Data */}
      <SectionHeader><Database size={10} className="inline mr-1.5 mb-0.5" />Data</SectionHeader>
      <div className="space-y-2">
        <Row label="Export data as JSON" onClick={exportData} />
        <Row
          label="Import from JSON"
          onClick={() => document.getElementById('import-file')?.click()}
        />
        <input id="import-file" type="file" accept=".json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importData(f) }} />
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
