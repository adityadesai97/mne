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

`src/App.tsx` gates on `config.isConfigured && isSupabaseReady()`. If false, `<Onboarding>` renders. Supabase is initialized at module load time from env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — there is no `initSupabase()` call. All DB calls go through `getSupabaseClient()`, which throws if the env vars were absent.

`src/store/config.ts` stores the following in localStorage:
- `mne_claude_api_key` — Claude API key
- `mne_groq_api_key` — Groq API key
- `mne_llm_provider` — active LLM provider (`claude` | `groq`; defaults to `claude`)
- `mne_finnhub_api_key` — Finnhub API key for stock quotes
- `mne_needs_signin` — flag set when the user is signed out
- `mne_theme` — appearance preference (`light` | `dark` | `system`)

`config.isConfigured` is true only when `config.activeApiKey` (key for the chosen provider), `config.finnhubApiKey`, and `!config.needsSignIn` are all satisfied.

On every app load, `src/layouts/AppLayout.tsx` runs a startup effect: loads assets, records a daily net worth snapshot, promotes stale Short Term tax lots to Long Term, and syncs API keys and the LLM provider to `user_settings`.

### Data Model

The current schema baseline lives in `supabase/migrations/20260302000000_baseline.sql`. Key relationships:

```
assets ──→ locations      (account lives at a brokerage/bank)
assets ──→ tickers        (stocks only; null for 401k/cash/etc.)
assets ──→ stock_subtypes (Market | ESPP | RSU — one per subtype per asset)
stock_subtypes ──→ transactions  (individual tax lots with cost_price + purchase_date)
stock_subtypes ──→ rsu_grants    (vest_start, vest_end, cliff_date, ended_at)
tickers ──→ ticker_themes ──→ themes
themes ──→ theme_targets  (optional allocation target %)
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

Seven pages in `src/pages/`:
- `Home` — net worth hero + chart
- `Portfolio` — position cards
- `AssetDetail` — drill-down view for a single asset
- `Charts` — allocation / P&L / RSU charts
- `Watchlist` — tickers + themes
- `Settings` — API keys, notifications, appearance
- `Landing` — marketing/intro page shown when `VITE_LANDING_AS_HOME=true`
- `Onboarding` — first-run wizard (API key setup, includes LLM provider picker)

All data pages support pull-to-refresh on mobile via `usePullToRefresh` (`src/hooks/usePullToRefresh.ts`) + `PullToRefreshIndicator` (`src/components/PullToRefreshIndicator.tsx`).

### Layouts

`src/layouts/`:
- `AppLayout.tsx` — root shell; runs startup effect on mount; calls `abortActiveImport()` on unmount
- `BottomNav.tsx` — mobile tab bar
- `Sidebar.tsx` — desktop navigation

### user_settings Columns

Key columns (all RLS-protected): `claude_api_key`, `groq_api_key`, `llm_provider`, `finnhub_api_key`, `price_alert_threshold`, `rsu_alert_days_before`, `auto_theme_assignment_enabled`, `price_alerts_enabled`, `vest_alerts_enabled`, `capital_gains_alerts_enabled`. Note: `tax_harvest_threshold` was removed (migration `20260303000001_remove_tax_harvest_threshold.sql`).

Home chart range is in `localStorage` (`mne_home_chart_range`, values: `1M | 3M | 6M | 1Y | ALL`), not DB.

### LLM Abstraction Layer

`src/lib/llm.ts` provides a unified LLM client interface supporting multiple providers:

- **Claude** (`claude` provider) — uses `@anthropic-ai/sdk` via a `ClaudeAdapter` that converts OpenAI-format messages/tools to the Anthropic API shape and normalizes responses back to OpenAI format.
- **Groq** (`groq` provider) — uses the `openai` npm package pointed at `https://api.groq.com/openai/v1`.

`createLLMClient(provider, apiKey)` returns an `LLMClient` that implements the OpenAI `chat.completions.create` interface regardless of the underlying provider.

Models used: `claude-sonnet-4-6` (Claude), `llama-3.3-70b-versatile` (Groq). Both are defined in `MODEL_FOR_PROVIDER`.

All AI features (`src/lib/claude.ts`, `src/lib/autoThemes.ts`) call `createLLMClient(config.llmProvider, config.activeApiKey)` so they work with either provider.

### AI Command Bar

`src/lib/claude.ts` is the core AI feature. The command bar (⌘K / Cmd+K) collects natural language input and routes it through the LLM. The agent runs a read-tool loop until a write or navigation tool is selected.

**Read tools** (loop freely, no confirmation):
- `get_portfolio_summary` — high-level net worth + allocation stats
- `get_positions` — detailed position rows
- `get_transactions` — tax lot details
- `get_net_worth_timeseries` — historical net worth snapshots
- `get_exposure_breakdown` — breakdown by ticker / theme / asset_type / location
- `analyze_tax_lots` — short/long-term capital gains analysis
- `simulate_portfolio_actions` — hypothetical what-if scenarios
- `recommend_actions_for_goal` — goal-based recommendations

**Navigation tool** (no confirmation):
- `navigate_to` — routes to a page

**Write tools** (require user confirmation before executing):
- `add_stock_transaction` / `add_stock_transactions`
- `add_cash_asset` / `add_cash_assets`
- `add_ticker_to_watchlist`
- `add_ticker_themes`
- `add_rsu_grant` / `add_rsu_grants`
- `sell_shares`
- `update_asset_value`

Write operations display a structured preview table in the UI before the user confirms. Multiple write tools in one agent turn are batched into a single confirmation dialog. Prefix commands with `mock:` to test the UI flow without making API or DB calls.

The command bar requires the user to be signed in; if not, it prompts re-authentication.

### In-App Alerts

`src/lib/appAlerts.ts` — lightweight pub/sub for transient toast-style notifications. `showAppAlert(message, options)` fires an event consumed by `AppAlertsHost.tsx`. Variants: `info`, `success`, `error`.

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

Tests live in `src/__tests__/`. Current test files:
- `App.test.tsx`, `Home.test.tsx`, `Onboarding.test.tsx` — component smoke tests
- `BottomNav.test.tsx`, `CommandBar.test.tsx` — UI component tests
- `charts.test.ts`, `portfolio.test.ts` — pure computation tests
- `claude.test.ts` — AI command logic tests
- `llm.test.ts` — LLM adapter/client tests
- `config.test.ts` — config store tests
- `importExport.test.ts` — backup/restore tests

Pattern: plain Vitest `test()` calls (no `describe` blocks), mock objects typed as `any`. Supabase calls are not mocked — tests that need DB use real fixtures or test pure computation functions. The test environment is `jsdom` with globals enabled.

### Import/Export

`src/lib/importExport.ts` — full portfolio backup/restore. Exports a `mne.export.v2` JSON blob (assets, tickers, themes, locations). Accessible from Settings. `abortActiveImport()` is called in `AppLayout` on unmount to cancel in-flight imports.

### Auto Theme Assignment

`src/lib/autoThemes.ts` — uses the active LLM (via `createLLMClient`) to automatically suggest and assign themes to tickers based on their sector/industry. Controlled by `auto_theme_assignment_enabled` in `user_settings`.

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

**DB migrations**: Applied via Supabase MCP (`apply_migration` tool) or the Supabase dashboard SQL editor. There is no local Supabase CLI setup — all schema changes go directly to the hosted project. `supabase/sql/self_host_bootstrap.sql` is a standalone idempotent script used by `setup.sh` and `upgrade.sh` to initialize or upgrade a self-hosted Supabase project.

**Migration policy — keep bootstrap.sql in sync**: Every schema change must be reflected in BOTH `supabase/migrations/<timestamp>_<name>.sql` AND `supabase/sql/self_host_bootstrap.sql`. The bootstrap script is the source of truth for self-hosters; `upgrade.sh` re-runs it on every upgrade. Because the bootstrap uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `DROP COLUMN IF EXISTS` throughout, it is safe to re-run on any existing project at any version. New migrations that add columns should use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the bootstrap. Migrations that drop columns should use `DROP COLUMN IF EXISTS`. Migrations that rename or change column types need a compatible idempotent form (e.g. a DO block that checks for the old column and backfills before altering).

**`saveSettings` upsert**: Must include `{ onConflict: 'user_id' }` in the upsert call or updates silently fail with a unique constraint error when a row already exists.

**Missing `user_settings` columns**: A 400 from PostgREST on `/rest/v1/user_settings` often means a migration was never applied (column doesn't exist in DB), not a client bug. Check the response body for the actual column name.

**`gh` CLI not available**: `gh` is not installed. Create PRs via the GitHub web URL printed by `git push` instead.

**Notification edge functions**: Each `check-*` function reads `price_alerts_enabled` / `vest_alerts_enabled` / `capital_gains_alerts_enabled` from `user_settings` and skips push (but not DB promotion) when false.

**Adding a new LLM provider**: Add the provider type to `LLMProvider` in `src/store/config.ts`, add a case in `createLLMClient` in `src/lib/llm.ts`, add the model to `MODEL_FOR_PROVIDER`, add a key field to the config store, and add the `llm_provider` value + key column to `user_settings` via a migration and `self_host_bootstrap.sql`.

**OpenAI-format tool definitions**: All tools in `claude.ts` and `autoThemes.ts` use the OpenAI function-calling format (`{ type: 'function', function: { name, description, parameters } }`). `ClaudeAdapter` in `llm.ts` converts these to Anthropic format internally.
