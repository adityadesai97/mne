import { createClient } from '@supabase/supabase-js'

// Supabase credentials must be provided via env vars.
const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const AUTH_FAILURE_EVENT = 'mne:auth-failure'
let handlingAuthFailure = false

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function shouldForceSignOut(status: number, url: string): boolean {
  if (status === 401) return true
  if (status === 403 && (url.includes('/rest/v1/') || url.includes('/auth/v1/'))) return true
  return false
}

async function notifyAuthFailure(reason: string) {
  if (handlingAuthFailure) return
  handlingAuthFailure = true
  try {
    // Best-effort: clear server session/local tokens and let the app move back to onboarding.
    await client?.auth.signOut().catch(() => {})
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_FAILURE_EVENT, { detail: { reason } }))
    }
  } finally {
    handlingAuthFailure = false
  }
}

const authAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  const url = getRequestUrl(input)
  if (shouldForceSignOut(response.status, url)) {
    void notifyAuthFailure(`HTTP ${response.status} from ${url}`)
  }
  return response
}

const client = ENV_URL && ENV_KEY
  ? createClient(ENV_URL, ENV_KEY, { global: { fetch: authAwareFetch } })
  : null

export function isSupabaseReady(): boolean {
  return client !== null
}

export function getSupabaseClient() {
  if (!client) throw new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  return client
}

export function onAuthFailure(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener: EventListener = () => handler()
  window.addEventListener(AUTH_FAILURE_EVENT, listener)
  return () => window.removeEventListener(AUTH_FAILURE_EVENT, listener)
}
