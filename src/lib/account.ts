import { getSupabaseClient } from '@/lib/supabase'
import { config } from '@/store/config'

export interface AccountInfo { email: string; name: string }

export async function getAccountInfo(): Promise<AccountInfo | null> {
  const { data, error } = await getSupabaseClient().auth.getUser()
  if (error || !data.user) return null
  const meta = (data.user.user_metadata ?? {}) as { full_name?: string; name?: string }
  return { email: data.user.email ?? '', name: meta.full_name ?? meta.name ?? '' }
}

export async function signOutOfMne() {
  await getSupabaseClient().auth.signOut()
  config.markSignedOut()
  window.location.href = '/'
}

/** Google's account chooser; the new account's session replaces this one when it redirects back. */
export async function switchGoogleAccount(): Promise<string | null> {
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
  })
  return error ? error.message : null
}
