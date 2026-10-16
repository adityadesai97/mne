import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { config } from '@/store/config'
import { isSupabaseReady, getSupabaseClient } from '@/lib/supabase'
import { loadApiKeys, saveSettings } from '@/lib/db/settings'
import { saveLlmKey } from '@/lib/db/llmCredentials'
import { saveMarketKeys } from '@/lib/db/marketCredentials'
import { getPlaidCredentialsStatus, savePlaidCredentials, createPlaidLinkToken, exchangePlaidPublicToken } from '@/lib/db/plaid'
import { openPlaidLink } from '@/lib/plaidLink'
import { showAppAlert } from '@/lib/appAlerts'
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
    <div className="flex items-center gap-2.5">
      <img src="/logo.png" alt="" className="logo-adaptive h-8 w-auto object-contain" />
      <span className="font-display text-3xl font-medium leading-none tracking-tight text-foreground">mne</span>
    </div>
  )
}

/** Step meter: filled for completed and current steps, announced as "Step N of 4". */
function StepMeter({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`Step ${current} of 4`}>
      {[1, 2, 3, 4].map(n => (
        <i key={n} className={`h-1.5 flex-1 rounded-full ${n <= current ? 'bg-primary' : 'bg-muted'}`} />
      ))}
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
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {hint && (
          <a
            href={hint.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
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
        className="w-full rounded-sm border border-border-strong bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
    </div>
  )
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<'env' | 'checking' | 'auth' | 'apikeys' | 'plaid'>(
    () => isSupabaseReady() ? 'checking' : 'env'
  )
  const showLandingAsHome = isFlagEnabled(import.meta.env.VITE_LANDING_AS_HOME)
  const [aiKey, setAiKey] = useState('')
  const [finnhubKey, setFinnhubKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [plaidSubStep, setPlaidSubStep] = useState<'credentials' | 'connect'>('credentials')
  const [plaidClientId, setPlaidClientId] = useState('')
  const [plaidSecret, setPlaidSecret] = useState('')

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
        const supabase = getSupabaseClient()
        const { data: allowed } = await supabase
          .from('allowed_emails')
          .select('email')
          .eq('email', user.email)
          .maybeSingle()
        if (!allowed) {
          await supabase.auth.signOut()
          setError(UNAUTHORIZED_MESSAGE)
          setStep('auth')
          return
        }
      }

      const keys = await loadApiKeys()
      if (keys) {
        config.save(keys)
        config.clearSignedOut()
        // Plaid is optional and separate from the required API keys above —
        // only skip straight past it for a returning user who's already
        // configured it (or explicitly skipped it before).
        const plaidStatus = await getPlaidCredentialsStatus().catch(() => ({ configured: false }))
        if (plaidStatus.configured || config.plaidOnboardingSeen) { onComplete(); return }
        setStep('plaid')
        return
      }
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
    if (!aiKey || !finnhubKey) { setError('Both fields are required'); return }
    setLoading(true)
    setError('')
    try {
      // Creates the user_settings row (alert preferences, which the price
      // alert job iterates) without any key in it.
      await saveSettings({})
      // The API keys go to the server (write-only); they never land in
      // localStorage or a browser-readable table.
      await saveLlmKey(aiKey)
      await saveMarketKeys({ finnhubApiKey: finnhubKey })
      setLoading(false)
      setStep('plaid')
    } catch (e: any) {
      setError(e.message ?? 'Failed to save API keys')
      setLoading(false)
    }
  }

  function finishPlaidStep() {
    config.save({ plaidOnboardingSeen: true })
    onComplete()
  }

  async function handleSavePlaidCredentials() {
    if (!plaidClientId || !plaidSecret) { setError('Both fields are required'); return }
    setLoading(true)
    setError('')
    try {
      await savePlaidCredentials(plaidClientId, 'production', plaidSecret)
      setLoading(false)
      setPlaidSubStep('connect')
    } catch (e: any) {
      setError(e.message ?? 'Failed to save Plaid credentials')
      setLoading(false)
    }
  }

  async function handleConnectPlaidAccount() {
    setLoading(true)
    setError('')
    try {
      const linkToken = await createPlaidLinkToken()
      await openPlaidLink(linkToken, {
        onSuccess: (publicToken, metadata) => {
          exchangePlaidPublicToken(publicToken, metadata.institution?.institution_id ?? null, metadata.institution?.name ?? null)
            .then(({ pendingCount }) => {
              showAppAlert(
                pendingCount > 0
                  ? `Connected — ${pendingCount} position${pendingCount !== 1 ? 's' : ''} to review in Settings`
                  : 'Account connected',
                { variant: 'success' },
              )
            })
            .catch((e: Error) => showAppAlert(e.message || 'Failed to finish connecting that account', { variant: 'error' }))
            .finally(() => finishPlaidStep())
        },
        onExit: () => setLoading(false),
      })
    } catch (e: any) {
      setError(e.message ?? 'Failed to start Plaid Link')
      setLoading(false)
    }
  }

  const stepNumber = step === 'auth' ? 1 : step === 'apikeys' ? 2 : step === 'plaid' ? (plaidSubStep === 'credentials' ? 3 : 4) : 0
  const wrap = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="grid w-full max-w-[520px] gap-5">
        <Logo />
        {stepNumber > 0 && <StepMeter current={stepNumber} />}
        <section className="rounded-lg bg-card p-6 shadow-card">{children}</section>
      </div>
    </div>
  )

  if (step === 'env') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground">Supabase not configured</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set Supabase credentials via environment variables and restart the app.
        </p>
      </div>
      <div className="rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground space-y-1">
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
        <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground">Welcome</h1>
        <p className="text-sm text-muted-foreground mt-1">Continue with Google to sign in or create your account.</p>
      </div>
      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-border-strong bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" className="flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-loss">▼ {error}</p>}
    </div>
  )

  if (step === 'apikeys') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground">API keys</h1>
        <p className="text-sm text-muted-foreground mt-1">Needed for AI commands and live prices.</p>
      </div>
      <Field
        id="aiKey"
        label="Claude API Key"
        placeholder="sk-ant-..."
        value={aiKey}
        onChange={setAiKey}
        hint={{ text: 'Get key', href: 'https://console.anthropic.com/settings/keys' }}
      />
      <Field
        id="finnhubApiKey"
        label="Finnhub API Key"
        placeholder="your_key"
        value={finnhubKey}
        onChange={setFinnhubKey}
        hint={{ text: 'Get key', href: 'https://finnhub.io/dashboard' }}
      />
      {error && <p className="text-sm font-medium text-loss">▼ {error}</p>}
      <PrimaryBtn onClick={handleSaveApiKeys} disabled={loading}>
        {loading ? 'Saving…' : 'Continue'}
      </PrimaryBtn>
    </div>
  )

  if (step === 'plaid' && plaidSubStep === 'credentials') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground">Connect accounts (optional)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          mne can pull your stock, 401k, cash, and bond/T-bill positions from Plaid instead of you entering them
          by hand. This needs your own free Plaid developer account — a short signup, not a copy-paste key like
          the ones above — and stays entirely optional; you can set this up later from Settings instead.
        </p>
      </div>
      <Field
        id="plaidClientId"
        label="Plaid Client ID"
        placeholder="66..."
        value={plaidClientId}
        onChange={setPlaidClientId}
        hint={{ text: 'Get credentials', href: 'https://dashboard.plaid.com/team/keys' }}
      />
      <Field
        id="plaidSecret"
        label="Plaid Secret"
        placeholder="production secret"
        value={plaidSecret}
        onChange={setPlaidSecret}
      />
      {error && <p className="text-sm font-medium text-loss">▼ {error}</p>}
      <PrimaryBtn onClick={handleSavePlaidCredentials} disabled={loading}>
        {loading ? 'Saving…' : 'Save & continue'}
      </PrimaryBtn>
      <button
        onClick={finishPlaidStep}
        disabled={loading}
        className="w-full rounded-full py-2 text-center text-sm font-medium text-primary transition-colors hover:bg-muted"
      >
        Skip for now
      </button>
    </div>
  )

  if (step === 'plaid' && plaidSubStep === 'connect') return wrap(
    <div className="space-y-4">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-medium leading-tight tracking-tight text-foreground">Connect an account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Credentials saved. Connect your first brokerage or bank account now, or do it later from Settings —
          you can add up to 10 free connections.
        </p>
      </div>
      {error && <p className="text-sm font-medium text-loss">▼ {error}</p>}
      <PrimaryBtn onClick={handleConnectPlaidAccount} disabled={loading}>
        {loading ? 'Opening…' : 'Connect an account'}
      </PrimaryBtn>
      <button
        onClick={finishPlaidStep}
        disabled={loading}
        className="w-full rounded-full py-2 text-center text-sm font-medium text-primary transition-colors hover:bg-muted"
      >
        Skip for now
      </button>
    </div>
  )
}
