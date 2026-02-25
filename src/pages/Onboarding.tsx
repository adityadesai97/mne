import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { config } from '@/store/config'
import { isSupabaseReady, getSupabaseClient } from '@/lib/supabase'
import { loadApiKeys, saveSettings } from '@/lib/db/settings'
import Landing from './Landing'

interface Props { onComplete: () => void }
const UNAUTHORIZED_MESSAGE = 'User is not authorized to use this app.'

function isFlagEnabled(value?: string) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'no' && normalized !== 'off'
}

function Logo() {
  return (
    <div className="flex flex-col items-center gap-3 mb-8">
      <div className="w-12 h-12 flex items-center justify-center">
        <img src="/logo.png" alt="mne" className="w-full h-full object-cover logo-adaptive" />
      </div>
      <span className="font-syne text-lg font-semibold tracking-tight text-foreground">mne</span>
    </div>
  )
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  hint?: { text: string; href: string }
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </label>
        {hint && (
          <a
            href={hint.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors"
          >
            {hint.text}
            <ExternalLink size={10} />
          </a>
        )}
      </div>
      <input
        id={id}
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-shadow"
      />
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-medium hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  )
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<'env' | 'checking' | 'auth' | 'apikeys'>(
    () => isSupabaseReady() ? 'checking' : 'env'
  )
  const showLandingAsHome = isFlagEnabled(import.meta.env.VITE_LANDING_AS_HOME)
  const [apiKeys, setApiKeys] = useState({ claudeApiKey: '', finnhubApiKey: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // When we land on 'checking', verify if a session already exists.
  // Uses onAuthStateChange instead of getSession() so we catch the async
  // PKCE code exchange that happens after Google OAuth redirects back.
  useEffect(() => {
    if (step !== 'checking') return
    let resolved = false

    async function handleSession(session: { user: any }) {
      if (resolved) return
      resolved = true
      const { user } = session

      // Email allowlist check — only runs when VITE_RESTRICT_SIGNUPS=true
      if (import.meta.env.VITE_RESTRICT_SIGNUPS === 'true') {
        const { data } = await getSupabaseClient()
          .from('allowed_emails')
          .select('email')
          .eq('email', user.email)
          .maybeSingle()
        if (!data) {
          await getSupabaseClient().auth.signOut()
          setError(UNAUTHORIZED_MESSAGE)
          setStep('auth')
          return
        }
      }

      const keys = await loadApiKeys()
      if (keys) { config.save(keys); config.clearSignedOut(); onComplete(); return }
      config.clearSignedOut()
      setStep('apikeys')
    }

    const { data: { subscription } } = getSupabaseClient().auth.onAuthStateChange(
      (event, session) => {
        if (session) {
          handleSession(session)
        } else if (event === 'INITIAL_SESSION' && !session && !resolved) {
          resolved = true; setStep('auth')
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [step])

  async function handleGoogleSignIn() {
    setLoading(true)
    setError('')
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  async function handleSaveApiKeys() {
    if (!apiKeys.claudeApiKey || !apiKeys.finnhubApiKey) { setError('Both fields are required'); return }
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) { setError('Not authenticated'); setLoading(false); return }
      await saveSettings({ user_id: user.id, claude_api_key: apiKeys.claudeApiKey, finnhub_api_key: apiKeys.finnhubApiKey })
      config.save(apiKeys)
      onComplete()
    } catch (e: any) {
      setError(e.message ?? 'Failed to save API keys')
      setLoading(false)
    }
  }

  const wrap = (children: React.ReactNode, opts?: { liftLogo?: boolean }) => (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm">
        <div className={opts?.liftLogo ? '-translate-y-12 sm:-translate-y-16' : ''}>
          <Logo />
        </div>
        {children}
      </div>
    </div>
  )

  if (step === 'env') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-syne text-xl font-semibold text-foreground">Supabase not configured</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set Supabase credentials via environment variables and restart the app.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs text-muted-foreground space-y-1">
        <p>VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co</p>
        <p>VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY</p>
      </div>
    </div>
  )

  if (step === 'checking') return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground text-sm">Loading…</p>
    </div>
  )

  if (step === 'auth' && showLandingAsHome) {
    return <Landing onSignIn={handleGoogleSignIn} loading={loading} error={error} />
  }

  if (step === 'auth') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-syne text-xl font-semibold text-foreground">Welcome</h1>
        <p className="text-sm text-muted-foreground mt-1">Continue with Google to sign in or create your account.</p>
      </div>
      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 active:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" className="flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {error && <p className="text-destructive text-xs mt-2">{error}</p>}
    </div>
  , { liftLogo: true })

  return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-syne text-xl font-semibold text-foreground">API keys</h1>
        <p className="text-sm text-muted-foreground mt-1">Needed for AI commands and live prices.</p>
      </div>
      <Field
        id="claudeApiKey"
        label="Claude API Key"
        placeholder="sk-ant-..."
        value={apiKeys.claudeApiKey}
        onChange={v => setApiKeys(f => ({ ...f, claudeApiKey: v }))}
        hint={{ text: 'Get key', href: 'https://console.anthropic.com/settings/keys' }}
      />
      <Field
        id="finnhubApiKey"
        label="Finnhub API Key"
        placeholder="your_key"
        value={apiKeys.finnhubApiKey}
        onChange={v => setApiKeys(f => ({ ...f, finnhubApiKey: v }))}
        hint={{ text: 'Get key', href: 'https://finnhub.io/dashboard' }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <PrimaryBtn onClick={handleSaveApiKeys} disabled={loading}>
        {loading ? 'Saving…' : 'Continue'}
      </PrimaryBtn>
    </div>
  )
}
