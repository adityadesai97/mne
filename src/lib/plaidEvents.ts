// The "N synced positions to review" banner (AppLayout) and the review screen/Settings list
// (which can be opened from either place) each hold their own pending count. This is the one
// signal any of them fires when that count may have changed, so the banner never goes stale.

const EVENT = 'mne:plaid-pending-changed'

export function notifyPlaidPendingChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/** Subscribes to pending-count changes; returns the unsubscribe function. */
export function onPlaidPendingChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}
