import { getSupabaseClient, isSupabaseReady } from './supabase'

// Self-hosted error tracking: uncaught errors are written to public.client_errors
// in the app's own Supabase project (insert-only for signed-in users). Only the
// error message, stack, page path and browser are sent, never portfolio data.
// Reporting is best-effort and must never itself throw or loop.

const MAX_PER_SESSION = 20
const MAX_FIELD = 4000
const seen = new Set<string>()
let sent = 0

const clip = (s: string | undefined | null, n = MAX_FIELD) => (s ? s.slice(0, n) : undefined)

// Keep numbers out of messages so a dollar amount in an error never lands in the table.
const scrub = (s: string) => s.replace(/\$\s?\d[\d,.]*/g, '$#')

export async function reportError(source: string, err: unknown): Promise<void> {
  try {
    if (!isSupabaseReady()) return
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown')
    const message = scrub(e.message || e.name || 'Unknown error')
    const key = `${source}:${message}`
    if (seen.has(key) || sent >= MAX_PER_SESSION) return
    seen.add(key)
    sent += 1
    const { error } = await getSupabaseClient().from('client_errors').insert({
      source,
      message: clip(message)!,
      stack: clip(e.stack ? scrub(e.stack) : undefined),
      url: window.location.pathname,
      app_version: clip(import.meta.env.VITE_APP_VERSION as string | undefined, 64),
      user_agent: clip(navigator.userAgent, 300),
    })
    // Signed out, or the table isn't deployed yet: nothing more to do.
    if (error) console.debug('Error report not saved:', error.message)
  } catch {
    /* never let reporting break the app */
  }
}

let installed = false
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', ev => { void reportError('window.onerror', ev.error ?? ev.message) })
  window.addEventListener('unhandledrejection', ev => { void reportError('unhandledrejection', ev.reason) })
}

/** Test hook. */
export function _resetErrorReporting(): void { seen.clear(); sent = 0 }
