import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { config } from '@/store/config'
import { initSupabase } from '@/lib/supabase'

interface Props { onComplete: () => void }

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<'keys' | 'auth'>('keys')
  const [form, setForm] = useState({
    supabaseUrl: '', supabaseAnonKey: '', claudeApiKey: '', finnhubApiKey: '',
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSaveKeys() {
    if (!form.supabaseUrl || !form.supabaseAnonKey || !form.claudeApiKey || !form.finnhubApiKey) {
      setError('All fields are required')
      return
    }
    try { new URL(form.supabaseUrl) } catch {
      setError('Supabase URL must be a valid URL (e.g. https://xxxx.supabase.co)')
      return
    }
    config.save(form)
    initSupabase(form.supabaseUrl, form.supabaseAnonKey)
    setStep('auth')
    setError('')
  }

  async function handleAuth(mode: 'signin' | 'signup') {
    setLoading(true)
    setError('')
    const { getSupabaseClient } = await import('@/lib/supabase')
    const supabase = getSupabaseClient()
    const fn = mode === 'signup'
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })
    const { data, error } = await fn
    setLoading(false)
    if (error) { setError(error.message); return }
    if (!data.session) {
      setError('Check your email to confirm your account, then sign in.')
      return
    }
    onComplete()
  }

  if (step === 'keys') return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Welcome to mne</CardTitle>
          <CardDescription>Connect your own accounts to get started.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: 'Supabase Project URL', key: 'supabaseUrl', placeholder: 'https://xxxx.supabase.co' },
            { label: 'Supabase Anon Key', key: 'supabaseAnonKey', placeholder: 'eyJ...' },
            { label: 'Claude API Key', key: 'claudeApiKey', placeholder: 'sk-ant-...' },
            { label: 'Finnhub API Key', key: 'finnhubApiKey', placeholder: 'your_key' },
          ].map(({ label, key, placeholder }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                type="password"
                placeholder={placeholder}
                value={form[key as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button className="w-full" onClick={handleSaveKeys}>Continue</Button>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Create or sign into your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="ob-email">Email</Label>
            <Input id="ob-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-password">Password</Label>
            <Input id="ob-password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button className="w-full" onClick={() => handleAuth('signin')} disabled={loading}>Sign In</Button>
          <Button variant="outline" className="w-full" onClick={() => handleAuth('signup')} disabled={loading}>Create Account</Button>
        </CardContent>
      </Card>
    </div>
  )
}
