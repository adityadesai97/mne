# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server on localhost:5173
npm run build     # tsc -b && vite build (type-check first)
npm run preview   # serve dist/ on localhost:4173
npm run lint      # ESLint
npm test          # Vitest (watch mode)
npx vitest --run                  # single run, all tests
npx vitest --run charts.test      # single file
```

## Architecture

**mne** is a personal finance tracker — a single-page React app backed entirely by Supabase (Postgres + Auth + Edge Functions). No server-side rendering; all logic runs in the browser or in Supabase edge functions.

### Startup & Auth

`src/App.tsx` gates on `config.isConfigured && isSupabaseReady()`. If false, `<Onboarding>` renders. Supabase is initialized at module load time from env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — there is no `initSupabase()` call. All DB calls go through `getSupabaseClient()`, which throws if the env vars were absent. `src/store/config.ts` stores only `mne_claude_api_key`, `mne_finnhub_api_key`, `mne_needs_signin`, and `mne_theme` in localStorage.

On every app load, `src/layouts/AppLayout.tsx` runs a startup effect: loads assets, records a daily net worth snapshot, promotes stale Short Term tax lots to Long Term, and syncs the Finnhub API key to `user_settings`.

### Data Model

The schema lives in `supabase/migrations/20260220000001_initial_schema.sql`. Key relationships:

```
assets ──→ locations      (account lives at a brokerage/bank)
assets ──→ tickers        (stocks only; null for 401k/cash/etc.)
assets ──→ stock_subtypes (Market | ESPP | RSU — one per subtype per asset)
stock_subtypes ──→ transactions  (individual tax lots with cost_price + purchase_date)
stock_subtypes ──→ rsu_grants    (vest_start, vest_end, cliff_date, ended_at)
tickers ──→ ticker_themes ──→ themes
```

Every table has RLS enabled — users see only their own rows.

All DB access goes through thin wrappers in `src/lib/db/`: `assets.ts`, `transactions.ts`, `tickers.ts`, `locations.ts`, `settings.ts`, `grants.ts`, `snapshots.ts`, `themes.ts`. These are plain async functions that call `getSupabaseClient()` directly — no ORM, no query builder abstraction beyond the Supabase JS client.

### Portfolio Math

`src/lib/portfolio.ts` contains all value calculations:
- Stock value = shares (sum of `transactions.count`) × `tickers.current_price`
- Non-stock value = `assets.price`
- Cost basis = sum of (`count × cost_price`) per tax lot

`src/lib/charts.ts` derives chart datasets (allocation, P&L, capital gains exposure, RSU vesting progress) by transforming the deeply-nested asset graph returned by `getAllAssets()`.

### Pages

Five pages in `src/pages/`: `Home` (net worth hero + chart), `Portfolio` (position cards), `Charts` (allocation/P&L/RSU charts), `Watchlist` (tickers + themes), `Settings` (API keys, notifications, appearance). All support pull-to-refresh on mobile via `usePullToRefresh` (`src/hooks/usePullToRefresh.ts`) + `PullToRefreshIndicator` (`src/components/PullToRefreshIndicator.tsx`).

### user_settings Columns

Key columns (all RLS-protected): `price_alert_threshold`, `tax_harvest_threshold`, `rsu_alert_days_before`, `auto_theme_assignment_enabled`, `price_alerts_enabled`, `vest_alerts_enabled`, `capital_gains_alerts_enabled`. Home chart range is in `localStorage` (`mne_home_chart_range`, values: `1M | 3M | 6M | 1Y | ALL`), not DB.

### Claude AI Commands

`src/lib/claude.ts` is the core AI feature. The command bar (⌘K) collects natural language input and sends it to the Claude API. Read tools loop until a write/nav tool is selected — full tool list in `src/lib/claude.ts`. `executeTool()` maps tool calls to the correct DB write + UI update. Write operations show a confirmation message before executing. Prefix commands with `mock:` to test the UI flow without making API or DB calls.

### Edge Functions

Four Deno functions in `supabase/functions/`:
- `send-push` — sends Web Push notifications via `npm:web-push`; requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` secrets
- `check-prices` — fetches Finnhub quotes, fires push if price moved ≥ user threshold
- `check-vests` — alerts when RSU `vest_end` is within `rsu_alert_days_before` days
- `check-capital-gains` — promotes Short Term lots older than 1 year to Long Term, sends push

`check-*` functions are scheduled hourly (prices/vests) or daily at 9am (capital gains) via pg_cron. They call `send-push` using `SUPABASE_ANON_KEY` (functions are deployed with `verify_jwt: false`).

### PWA & Service Worker

`vite-plugin-pwa` uses the `injectManifest` strategy, sourcing `src/sw.ts`. The service worker handles `push` events (shows notification) and `notificationclick` (opens `/`). `src/sw.ts` is excluded from the app's TypeScript compilation (`tsconfig.app.json`) because it runs in `ServiceWorkerGlobalScope`, not the browser window.

### Testing

Tests live in `src/__tests__/`. Pattern: plain Vitest `test()` calls (no `describe` blocks), mock objects typed as `any`. Supabase calls are not mocked — tests that need DB use real fixtures or test pure computation functions. The test environment is `jsdom` with globals enabled.

### Import/Export

`src/lib/importExport.ts` — full portfolio backup/restore. Exports a `mne.export.v2` JSON blob (assets, tickers, themes, locations). Accessible from Settings. `abortActiveImport()` is called in `AppLayout` on unmount to cancel in-flight imports.

### Auto Theme Assignment

`src/lib/autoThemes.ts` — uses Claude API to automatically suggest and assign themes to tickers based on their sector/industry. Controlled by `auto_theme_assignment_enabled` in `user_settings` (added in migration `20260225000002_user_settings_auto_theme_assignment.sql`).

## Environment Variables

Required (in `.env.local`):
```bash
VITE_SUPABASE_URL=        # Supabase project URL
VITE_SUPABASE_ANON_KEY=   # Supabase anon key
```

Optional:
```bash
VITE_RESTRICT_SIGNUPS=false   # Only allow emails in public.allowed_emails table
VITE_LANDING_AS_HOME=false    # Show landing page before sign-in
VITE_VAPID_PUBLIC_KEY=        # Required for push notifications
```

## Gotchas

**RLS on new tables**: Every new Supabase table needs an explicit RLS policy or all writes silently fail with a policy violation. Check `supabase/migrations/` for the pattern used on existing tables.

**deleteAsset cascade**: There is no `ON DELETE CASCADE` at the DB level. `deleteAsset()` in `src/lib/db/assets.ts` manually deletes `transactions` → `rsu_grants` → `stock_subtypes` before deleting the asset. Any new child tables added to `stock_subtypes` must be added to this function.

**Push notifications in production**: Requires `VITE_VAPID_PUBLIC_KEY` in `.env.local` and the three VAPID secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) set in Supabase dashboard → Settings → Edge Functions → Secrets.

**DB migrations**: Applied via Supabase MCP (`apply_migration` tool) or the Supabase dashboard SQL editor. There is no local Supabase CLI setup — all schema changes go directly to the hosted project. `supabase/sql/self_host_bootstrap.sql` is a standalone script to initialize a fresh Supabase project for self-hosting.

**`saveSettings` upsert**: Must include `{ onConflict: 'user_id' }` in the upsert call or updates silently fail with a unique constraint error when a row already exists.

**Missing `user_settings` columns**: A 400 from PostgREST on `/rest/v1/user_settings` often means a migration was never applied (column doesn't exist in DB), not a client bug. Check the response body for the actual column name.

**`gh` CLI not available**: `gh` is not installed. Create PRs via the GitHub web URL printed by `git push` instead.

**Notification edge functions**: Each `check-*` function reads `price_alerts_enabled` / `vest_alerts_enabled` / `capital_gains_alerts_enabled` from `user_settings` and skips push (but not DB promotion) when false.
