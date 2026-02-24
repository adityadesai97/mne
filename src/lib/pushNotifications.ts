import { getSupabaseClient } from './supabase'

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications not supported on this browser')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied')

  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Service worker not ready')), 5000)),
  ]) as ServiceWorkerRegistration
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  })

  const json = sub.toJSON()
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Delete old subscriptions for this user first so we never accumulate stale entries
  await supabase.from('push_subscriptions').delete().eq('user_id', user.id)
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: (json.keys as any).p256dh,
    auth: (json.keys as any).auth,
  })
  if (error) throw new Error(`Failed to save subscription: ${error.message}`)
}

// True only if browser permission is granted AND a subscription row exists in Supabase
export async function getPushEnabled(): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const supabase = getSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { data } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

export async function unsubscribeFromPush() {
  // Browser-side unsubscribe — guarded by a 3s timeout so a stale SW never hangs the call
  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sw timeout')), 3000)),
      ]) as ServiceWorkerRegistration
      const sub = await reg.pushManager?.getSubscription()
      await sub?.unsubscribe()
    }
  } catch { /* best-effort */ }

  // Always remove from DB so edge functions stop sending pushes
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await supabase.from('push_subscriptions').delete().eq('user_id', user.id)
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)))
}
