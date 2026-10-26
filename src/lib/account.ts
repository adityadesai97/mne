import { getSupabaseClient } from '@/lib/supabase'
import { config } from '@/store/config'
import { listPlaidItems, disconnectPlaidItem } from '@/lib/db/plaid'

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

/** Plaid keeps the connection alive on its side until told otherwise, so drop each one before its local record goes. */
async function disconnectAllPlaidItems() {
  try {
    for (const item of await listPlaidItems()) await disconnectPlaidItem(item.id).catch(() => {})
  } catch { /* Plaid tables may not exist on an older schema */ }
}

/** Deletes the portfolio, history and connections but keeps the account, settings and saved API keys. */
export async function deleteMyData() {
  await disconnectAllPlaidItems()
  const { error } = await getSupabaseClient().rpc('delete_my_data')
  if (error) throw new Error(error.message)
}

/** Permanently deletes the account and everything in it, then signs out. */
export async function deleteMyAccount() {
  await disconnectAllPlaidItems()
  const { data, error } = await getSupabaseClient().functions.invoke('delete-account')
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not delete the account')
  localStorage.clear()
  await getSupabaseClient().auth.signOut().catch(() => {})
  config.markSignedOut()
  window.location.href = '/'
}
