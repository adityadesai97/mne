// src/lib/priceRefresh.ts
import { refreshAllPrices } from './db/tickers'
import { config } from '@/store/config'

// Shared with Portfolio's "Prices refreshed Xm ago" display — written here
// too (not just from an explicit manual/pull-to-refresh) so that timestamp
// reflects this automatic on-load refresh as well.
export const PRICES_REFRESHED_AT_KEY = 'mne_prices_refreshed_at'

// A plain module-scoped promise is enough to dedup across callers: it
// resets naturally on every real page load (the whole module graph
// re-evaluates from scratch), and any page that mounts during the same
// load shares this one in-flight/resolved promise instead of triggering
// its own redundant Finnhub call.
let inFlight: Promise<void> | null = null

/**
 * Manual refresh (Portfolio's refresh button): refetches every price now,
 * regardless of the once-per-load guard, and replaces the shared promise so
 * pages mounted afterwards see the fresh result.
 */
export function refreshPricesNow(): Promise<void> {
  if (!config.hasFinnhubKey) return Promise.resolve()
  inFlight = refreshAllPrices().then(
    () => { localStorage.setItem(PRICES_REFRESHED_AT_KEY, new Date().toISOString()) },
    () => undefined,
  )
  return inFlight
}

/**
 * Refreshes every ticker's price from Finnhub, at most once per page load.
 * Home and Portfolio both await this before their initial asset fetch, so
 * whichever one happens to be open on a fresh page load renders current
 * prices instead of whatever was cached from a previous visit — without
 * either page (or a same-session nav between them) triggering its own
 * separate refresh. Best-effort: no API key, a network error, or a bad key
 * all resolve rather than reject, so a failed refresh never blocks a page
 * from rendering with whatever prices are already in the database.
 */
export function refreshPricesOncePerLoad(): Promise<void> {
  if (!config.hasFinnhubKey) return Promise.resolve()
  if (!inFlight) {
    inFlight = refreshAllPrices().then(
      () => { localStorage.setItem(PRICES_REFRESHED_AT_KEY, new Date().toISOString()) },
      () => undefined,
    )
  }
  return inFlight
}
