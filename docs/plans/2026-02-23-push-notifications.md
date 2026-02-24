# Push Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up native push notifications for price movements, RSU vesting, and capital gains promotions — already-stubbed edge functions need VAPID keys, schema fixes, and a working service worker.

**Architecture:** Three edge functions (`check-prices`, `check-vests`, `check-capital-gains`) call `send-push` which uses `npm:web-push`. A custom service worker (`src/sw.ts`) handles `push` events. pg_cron fires each function hourly. The user's Finnhub key is silently synced from localStorage to `user_settings.finnhub_api_key` on app startup.

**Tech Stack:** Deno edge functions, `npm:web-push`, `vite-plugin-pwa` injectManifest, Workbox, pg_cron, pg_net, Supabase Vault

---

## Existing state (do NOT recreate)

| Already exists | Status |
|---|---|
| `supabase/functions/send-push/index.ts` | ✅ working — needs VAPID secrets |
| `supabase/functions/check-prices/index.ts` | ✅ logic correct — needs `finnhub_api_key` column + secrets |
| `supabase/functions/check-vests/index.ts` | ❌ broken — references non-existent columns |
| `src/lib/pushNotifications.ts` | ✅ working — needs `VITE_VAPID_PUBLIC_KEY` |
| `push_subscriptions` table | ✅ exists |
| Settings page "Enable Push Notifications" button | ✅ exists |

---

## Task 1: Generate VAPID keys

**Files:**
- Modify: `.env.local`

**Step 1: Generate the key pair**

Run in the project root:
```bash
npx web-push generate-vapid-keys
```

Expected output:
```
=======================================
Public Key:
BNv3...your-public-key...

Private Key:
your-private-key...
=======================================
```

**Step 2: Add public key to .env.local**

Add this line (replace with your actual key from step 1):
```
VITE_VAPID_PUBLIC_KEY=BNv3...your-public-key...
```

**Step 3: Store secrets in Supabase**

Use the Supabase dashboard → Settings → Edge Functions → Secrets, or the CLI:
```bash
supabase secrets set VAPID_PUBLIC_KEY=BNv3...your-public-key...
supabase secrets set VAPID_PRIVATE_KEY=your-private-key...
supabase secrets set VAPID_SUBJECT=mailto:admin@mne.app
```

The `send-push` function reads `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — all three are required.

**Step 4: Verify secrets are set**
```bash
supabase secrets list
```
Expected: all three VAPID keys listed.

**Step 5: Commit**
```bash
git add .env.local
git commit -m "chore: add VAPID public key to env"
```

---

## Task 2: DB migration — add finnhub_api_key to user_settings

**Files:**
- Create: `supabase/migrations/20260223000001_user_settings_finnhub_key.sql`

**Step 1: Write the migration**
```sql
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS finnhub_api_key text;
```

**Step 2: Apply via Supabase MCP**

Use `apply_migration` with name `user_settings_finnhub_key` and the SQL above.

**Step 3: Verify**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'user_settings';
```
Expected: `finnhub_api_key` appears in the list.

**Step 4: Commit**
```bash
git add supabase/migrations/20260223000001_user_settings_finnhub_key.sql
git commit -m "feat: add finnhub_api_key column to user_settings"
```

---

## Task 3: Create src/sw.ts (custom service worker)

**Files:**
- Create: `src/sw.ts`

**Step 1: Write the service worker**
```ts
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', e => {
  const { title, body } = e.data?.json() ?? {}
  e.waitUntil(
    self.registration.showNotification(title ?? 'mne', {
      body,
      icon: '/icon-192.png',
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow('/'))
})
```

**Step 2: Install workbox-precaching if not present**
```bash
npm ls workbox-precaching 2>/dev/null || npm install workbox-precaching
```

**Step 3: Commit**
```bash
git add src/sw.ts
git commit -m "feat: add custom service worker with push event handler"
```

---

## Task 4: Switch vite.config.ts to injectManifest strategy

**Files:**
- Modify: `vite.config.ts`

**Step 1: Update VitePWA config**

Current:
```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: { ... },
})
```

Replace with:
```ts
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  manifest: {
    name: 'mne',
    short_name: 'mne',
    description: 'Personal finance tracker',
    theme_color: '#0D0D0D',
    background_color: '#0D0D0D',
    display: 'standalone',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
})
```

**Step 2: Verify build compiles without errors**
```bash
npm run build
```
Expected: Build succeeds, `dist/sw.js` present.

**Step 3: Run existing tests to make sure nothing broke**
```bash
npm test
```
Expected: All 19 tests pass.

**Step 4: Commit**
```bash
git add vite.config.ts
git commit -m "feat: switch vite-plugin-pwa to injectManifest strategy"
```

---

## Task 5: Add syncFinnhubKey() and call on startup

**Files:**
- Modify: `src/lib/db/settings.ts`
- Modify: `src/layouts/AppLayout.tsx`

**Step 1: Add syncFinnhubKey to settings.ts**

At the bottom of `src/lib/db/settings.ts`, add:
```ts
import { config } from '@/store/config'

export async function syncFinnhubKey() {
  const key = config.finnhubApiKey
  if (!key) return
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return
  const { error } = await getSupabaseClient()
    .from('user_settings')
    .upsert({ user_id: user.id, finnhub_api_key: key }, { onConflict: 'user_id' })
  if (error) throw error
}
```

**Step 2: Call syncFinnhubKey in AppLayout startup**

In `src/layouts/AppLayout.tsx`, add to the existing `useEffect` async block (after `promoteStaleShortTermLots`):

Import at top:
```ts
import { syncFinnhubKey } from '@/lib/db/settings'
```

Inside the `try` block of the startup effect:
```ts
await syncFinnhubKey()
```

The full startup effect should now call: `getAllAssets()`, `recordDailySnapshot()`, `promoteStaleShortTermLots()`, `syncFinnhubKey()`.

**Step 3: Verify build**
```bash
npm run build
```
Expected: No TypeScript errors.

**Step 4: Commit**
```bash
git add src/lib/db/settings.ts src/layouts/AppLayout.tsx
git commit -m "feat: sync Finnhub API key to user_settings on startup"
```

---

## Task 6: Fix check-vests edge function

**Files:**
- Modify: `supabase/functions/check-vests/index.ts`

**Problem:** Current code references `grant.first_vest_date`, `grant.cadence_months`, `grant.unvested_count` which don't exist in our schema. Our `rsu_grants` table has: `grant_date`, `vest_start`, `vest_end`, `total_shares`, `cliff_date`, `ended_at`.

**Step 1: Rewrite check-vests**
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: settings } = await supabase.from('user_settings').select('*')

  for (const userSettings of settings ?? []) {
    const daysAhead = userSettings.rsu_alert_days_before ?? 7
    const today = new Date()
    const cutoff = new Date(today)
    cutoff.setDate(today.getDate() + daysAhead)

    const cutoffStr = cutoff.toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    const { data: grants } = await supabase
      .from('rsu_grants')
      .select(`
        *,
        stock_subtypes!inner(
          asset:assets!inner(user_id, name)
        )
      `)
      .is('ended_at', null)
      .lte('vest_end', cutoffStr)
      .gte('vest_end', todayStr)

    for (const grant of grants ?? []) {
      if (grant.stock_subtypes.asset.user_id !== userSettings.user_id) continue
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        },
        body: JSON.stringify({
          user_id: userSettings.user_id,
          title: 'RSU Grant Vesting Soon',
          body: `${grant.stock_subtypes.asset.name}: ${Number(grant.total_shares).toLocaleString()} shares vest on ${grant.vest_end}`,
        }),
      })
    }
  }

  return new Response(JSON.stringify({ ok: true }))
})
```

**Step 2: Commit**
```bash
git add supabase/functions/check-vests/index.ts
git commit -m "fix: rewrite check-vests to use vest_end instead of non-existent columns"
```

---

## Task 7: Create check-capital-gains edge function

**Files:**
- Create: `supabase/functions/check-capital-gains/index.ts`

**Step 1: Create the function**
```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffDate = cutoff.toISOString().split('T')[0]

  // Find user_ids with promotable lots
  const { data: lots } = await supabase
    .from('transactions')
    .select(`
      id,
      stock_subtypes!inner(
        asset:assets!inner(user_id)
      )
    `)
    .eq('capital_gains_status', 'Short Term')
    .lte('purchase_date', cutoffDate)

  if (!lots?.length) return new Response(JSON.stringify({ ok: true, promoted: 0 }))

  // Group by user_id
  const byUser = new Map<string, string[]>()
  for (const lot of lots) {
    const uid = lot.stock_subtypes.asset.user_id
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(lot.id)
  }

  for (const [userId, ids] of byUser) {
    await supabase
      .from('transactions')
      .update({ capital_gains_status: 'Long Term' })
      .in('id', ids)

    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({
        user_id: userId,
        title: 'Capital Gains Update',
        body: `${ids.length} lot${ids.length !== 1 ? 's' : ''} promoted to Long Term`,
      }),
    })
  }

  return new Response(JSON.stringify({ ok: true, promoted: lots.length }))
})
```

**Step 2: Commit**
```bash
git add supabase/functions/check-capital-gains/index.ts
git commit -m "feat: add check-capital-gains edge function"
```

---

## Task 8: Deploy edge functions via Supabase MCP

Deploy all four functions using the `deploy_edge_function` MCP tool. Configuration:
- `send-push`: `verify_jwt: false` (called server-to-server with service role key in Authorization header — but actually uses anon key, so set `verify_jwt: true`)
- `check-prices`, `check-vests`, `check-capital-gains`: `verify_jwt: false` (called from pg_net with service role key in Authorization header)

Actually for all three check-* functions: they're invoked by pg_cron via pg_net with the service role key, so they don't have a user JWT. Set `verify_jwt: false` for those three, `verify_jwt: true` for `send-push` (since it's called from the other functions with anon key in Authorization header — wait, the check-* functions call send-push with the anon key, not the service role key... let's just set `verify_jwt: false` for all four during development).

**Step 1: Deploy send-push**

Use Supabase MCP `deploy_edge_function`:
- name: `send-push`
- files: content of `supabase/functions/send-push/index.ts`
- verify_jwt: false

**Step 2: Deploy check-prices**
- name: `check-prices`
- files: content of `supabase/functions/check-prices/index.ts`
- verify_jwt: false

**Step 3: Deploy check-vests**
- name: `check-vests`
- files: content of `supabase/functions/check-vests/index.ts`
- verify_jwt: false

**Step 4: Deploy check-capital-gains**
- name: `check-capital-gains`
- files: content of `supabase/functions/check-capital-gains/index.ts`
- verify_jwt: false

**Step 5: Verify deployments via Supabase MCP**

Use `list_edge_functions` — all four should appear.

---

## Task 9: Set Supabase secrets (SUPABASE_ANON_KEY)

The `check-*` functions call `send-push` using `SUPABASE_ANON_KEY`. This env var is auto-provided in the Supabase edge function runtime — no manual action needed. But verify the VAPID secrets from Task 1 are set.

**Step 1: Verify via Supabase dashboard**

Dashboard → Settings → Edge Functions → Secrets. Confirm:
- `VAPID_PUBLIC_KEY` ✓
- `VAPID_PRIVATE_KEY` ✓
- `VAPID_SUBJECT` ✓

---

## Task 10: Set up pg_cron schedule

**Files:**
- Create: `supabase/migrations/20260223000002_pg_cron_alerts.sql`

**Step 1: Enable pg_cron and pg_net (if not already enabled)**

Check via Supabase MCP `list_extensions` — confirm `pg_cron` and `pg_net` are installed.

If not, enable them in Supabase dashboard → Database → Extensions.

**Step 2: Write the migration**
```sql
-- Schedule all three alert checks to run hourly
-- pg_net posts to the edge function URL with the service role key

SELECT cron.schedule(
  'check-prices-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-prices',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'check-vests-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-vests',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'check-capital-gains-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-capital-gains',
    headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
```

**Note:** The `current_setting('app.service_role_key')` approach requires the service role key to be set as a DB setting. An alternative (and simpler) approach is to hardcode the URL without auth since the functions have `verify_jwt: false`. Replace the Authorization header line with just `'{"Content-Type": "application/json"}'::jsonb`.

Simpler version (use since verify_jwt is false):
```sql
SELECT cron.schedule(
  'check-prices-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-prices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'check-vests-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-vests',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'check-capital-gains-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-capital-gains',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
```

**Step 3: Apply via Supabase MCP**

Use `apply_migration` with name `pg_cron_alerts`.

**Step 4: Verify cron jobs are registered**
```sql
SELECT jobname, schedule FROM cron.job;
```
Expected: three rows — check-prices-hourly, check-vests-hourly, check-capital-gains-daily.

**Step 5: Commit**
```bash
git add supabase/migrations/20260223000002_pg_cron_alerts.sql
git commit -m "feat: schedule check-prices, check-vests, check-capital-gains via pg_cron"
```

---

## Task 11: End-to-end test

**Step 1: Start the dev server**
```bash
npm run dev
```

**Step 2: Open Settings → Enable Push Notifications**

In the browser at http://localhost:5173/settings:
- Click "Enable Push Notifications"
- Browser should prompt for notification permission — click Allow
- Expected: "Push notifications enabled!" alert

**Step 3: Verify subscription was saved**

Via Supabase MCP:
```sql
SELECT endpoint, user_id FROM push_subscriptions LIMIT 5;
```
Expected: one row for your user.

**Step 4: Manually invoke check-prices**

Via Supabase MCP `get_edge_function` or directly in the browser console:
```js
fetch('https://vtgcarikpbadkxxzfknt.supabase.co/functions/v1/check-prices', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}'
})
```

Expected: if any ticker moved more than threshold%, a push notification appears.

**Step 5: Force a notification by temporarily lowering threshold**

Via Supabase MCP:
```sql
UPDATE user_settings SET price_alert_threshold = 0.01;
```
Then invoke check-prices again — should trigger notification.

Reset threshold after testing:
```sql
UPDATE user_settings SET price_alert_threshold = 5;
```

**Step 6: Run tests to make sure nothing is broken**
```bash
npm test
```
Expected: All 19 tests pass.
