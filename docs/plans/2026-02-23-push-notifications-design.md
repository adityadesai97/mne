# Push Notifications Design

## Goal
Send native push notifications for price movements, RSU vesting reminders, and capital gains promotions — even when the app is closed.

## Architecture

### Components
1. **VAPID keys** — EC P-256 key pair for signing Web Push requests. Public key in `VITE_VAPID_PUBLIC_KEY` env var; private key in Supabase Vault secret `VAPID_PRIVATE_KEY`.
2. **Service worker** (`src/sw.ts`) — handles `push` events and calls `showNotification()`.
3. **`send-alerts` edge function** — runs hourly via `pg_cron`; fetches live prices, checks thresholds, sends Web Push.
4. **Settings sync** — Finnhub API key written to `user_settings.finnhub_api_key` transparently during onboarding (no new UI).

---

## Data Model Changes

### `user_settings` table — 2 new columns
- `finnhub_api_key text` — per-user Finnhub key, written on first app load from localStorage
- `last_price_check jsonb` — `{ "AAPL": 220.50, ... }` — prices at last edge function run; used to compute % change

No new tables.

---

## Service Worker (`src/sw.ts`)

Switch `vite-plugin-pwa` from `generateSW` to `injectManifest` strategy.

```ts
import { precacheAndRoute } from 'workbox-precaching'
declare const self: ServiceWorkerGlobalScope
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', e => {
  const { title, body } = e.data?.json() ?? {}
  e.waitUntil(
    self.registration.showNotification(title, { body, icon: '/icon-192.png' })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow('/'))
})
```

---

## Edge Function (`supabase/functions/send-alerts/index.ts`)

**Trigger:** `pg_cron` every hour → `pg_net.http_post` to the function URL with service role key.

**Per-user logic:**

### 1. Price alerts
- Fetch live prices from Finnhub for each owned ticker using `user_settings.finnhub_api_key`
- For each ticker: `|currentPrice - lastChecked| / lastChecked * 100 > price_alert_threshold`
- Send push: *"AAPL moved +6.2% (your threshold: 5%)"*
- Update `last_price_check` with current prices

### 2. RSU vesting reminders
- Find active grants (`ended_at IS NULL`) where `vest_end - today <= rsu_alert_days_before`
- Send push: *"AAPL RSU grant vests in 7 days (2026-03-01)"*
- Deduplicate: only alert once per grant per vest_end window (use `last_rsu_alert_date` column)

### 3. Capital gains promotions
- Find Short Term lots where `purchase_date <= today - 1 year`
- Promote them: `UPDATE transactions SET capital_gains_status = 'Long Term'`
- If any promoted: send push: *"2 lots promoted to Long Term capital gains"*
- Client-side `promoteStaleShortTermLots()` remains as a fallback (idempotent)

**VAPID signing:** Uses Web Crypto API (no npm packages) — sign JWT with the stored private key, POST to each subscription endpoint.

---

## Supabase Secrets Required
- `VAPID_PRIVATE_KEY` — JWK string for the EC P-256 private key
- `SUPABASE_SERVICE_ROLE_KEY` — for the edge function to make privileged DB writes

---

## Files to Create/Modify
| File | Change |
|------|--------|
| `src/sw.ts` | New — custom service worker |
| `vite.config.ts` | Switch to `injectManifest` strategy |
| `.env.local` | Add `VITE_VAPID_PUBLIC_KEY` |
| `src/lib/db/settings.ts` | Add `syncFinnhubKey()` helper |
| `src/App.tsx` | Call `syncFinnhubKey()` on startup |
| `supabase/functions/send-alerts/index.ts` | New — edge function |
| DB migration | Add columns to `user_settings`; add `pg_cron` schedule |
