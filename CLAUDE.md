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
- `mne_asset_view` — Portfolio layout preference (`grid` | `list`; unset until the user picks one, in which case Portfolio defaults to `list` on mobile and `grid` on desktop)

`config.isConfigured` is true only when `config.activeApiKey` (key for the chosen provider), `config.finnhubApiKey`, and `!config.needsSignIn` are all satisfied.

On every app load, `src/layouts/AppLayout.tsx` runs a startup effect: loads assets, records a daily net worth snapshot, promotes stale Short Term tax lots to Long Term, and syncs API keys and the LLM provider to `user_settings`.

`src/lib/priceRefresh.ts`'s `refreshPricesOncePerLoad()` refreshes every ticker's price from Finnhub at most once per page load (module-scoped promise, resets only on a real reload). Home and Portfolio both await it before their initial asset fetch, so whichever page is open on a fresh load renders current prices — not one triggered by AppLayout's own effect, since AppLayout doesn't own the asset state either page renders from.

### Data Model

The current schema baseline lives in `supabase/migrations/20260302000000_baseline.sql`. Key relationships:

`allowed_emails` — email allowlist used when `VITE_RESTRICT_SIGNUPS=true`. Includes an `is_admin boolean` column (the former `admin_users` table was merged in migration `20260331000000`). Admin check uses `public.is_allowed_email_admin()` (SECURITY DEFINER) to avoid self-referential RLS recursion. Managed via the Settings UI.

```
assets ──→ locations      (account lives at a brokerage/bank)
assets ──→ tickers        (stocks only; null for 401k/cash/etc.)
assets ──→ stock_subtypes (Market | ESPP | RSU — one per subtype per asset)
stock_subtypes ──→ transactions  (individual tax lots with cost_price + purchase_date)
stock_subtypes ──→ rsu_grants    (vest_start, vest_end, cliff_date, vesting_frequency, ended_at)
assets ──→ fixed_income_lots     (Bond/T-Bill only — units + cost/unit + purchase_date, like stock tax lots)
tickers ──→ ticker_themes ──→ themes
themes ──→ theme_targets  (optional allocation target %)
```

`assets.asset_type` is free text (no DB enum) but the app only creates: `Stock`, `401k`, `Cash`, `HSA`, and `Fixed Income`. `Fixed Income` is a super type covering CD, Deposit, Bond, and T-Bill accounts — `assets.fixed_income_subtype` ('CD' | 'Deposit' | 'Bond' | 'T-Bill', DB-constrained) records which, alongside `assets.interest_rate` (annual %, Bond coupon) and `assets.maturity_date`, both nullable and only meaningful when `asset_type = 'Fixed Income'`. Migration `20260811000000_add_fixed_income_asset_type.sql` folded the former standalone `CD` and `Deposit` asset types into this super type in place. T-Bills (and any Bond bought below par) sell at a discount and pay face value at maturity rather than accruing periodic interest — `assets.face_value` (nullable, added in `20260811000001_add_face_value_to_assets.sql`) holds the per-unit maturity payout.

**Bond and T-Bill are tradable** (migration `20260811000002_add_fixed_income_lots.sql`): bought in `fixed_income_lots` rows (`count` units × `cost_price` per unit × `purchase_date`), the same "buy over time in lots" shape as a stock's `transactions`, linked directly to `assets.id` (no intermediate subtype table — a Fixed Income asset only ever has one subtype). `assets.price`/`initial_price` are left `null` for these two subtypes; value is derived from lots instead (see Portfolio Math). CD and Deposit remain flat-balance accounts on `assets.price`, same as 401k/Cash/HSA.

**RSU vesting is discrete, not continuous** (migration `20260829000000_add_rsu_vesting_frequency.sql`): `rsu_grants.vesting_frequency` ('monthly' | 'quarterly' | 'annually' | 'continuous', DB-constrained, `NOT NULL DEFAULT 'quarterly'`) records how a grant vests after its cliff — a lump at `cliff_date` (or `vest_start` if no cliff was recorded) covering however many periods elapsed since `grant_date`, then one equal installment every period through `vest_end`, with the cliff absorbing the rounding remainder so installments sum to exactly `total_shares`. `continuous` falls back to the old smooth linear interpolation across `[vest_start, vest_end]`, for a grant nobody's told the app the real cadence of. `rsuVestedSharesAsOf` / `computeRsuVestEvents` in `src/lib/charts.ts` are the one implementation of this math — the RSU vesting progress chart, `computeRsuVestingSchedule` in `src/lib/claude.ts` (the command bar's `get_rsu_vesting_schedule` tool), and `supabase/functions/check-vests` (a self-contained Deno port, since edge functions can't import from `src/`) all key off it. Existing grants were backfilled to `'quarterly'` — the most common real-world schedule — confirmed against an actual user's brokerage statement.

Every table has RLS enabled — users see only their own rows.

All DB access goes through thin wrappers in `src/lib/db/`: `assets.ts`, `transactions.ts`, `tickers.ts`, `locations.ts`, `settings.ts`, `grants.ts`, `snapshots.ts`, `themes.ts`, `fixedIncomeLots.ts`. These are plain async functions that call `getSupabaseClient()` directly — no ORM, no query builder abstraction beyond the Supabase JS client.

### Portfolio Math

`src/lib/portfolio.ts` contains all value calculations:
- Stock value = shares (sum of `transactions.count`) × `tickers.current_price`
- Tradable Fixed Income value (Bond/T-Bill) = sum of `fixed_income_lots.count × cost_price` — held at cost, not marked to market (there's no live bond/bill quote feed)
- Other non-stock value (401k, Cash, HSA, CD, Deposit) = `assets.price`
- Cost basis = sum of (`count × cost_price`) per tax lot
- `computeUnrealizedGain` stays stock-only (P&L is a mark-to-market concept; never reported for non-stock assets, tradable or not)
- `computeFixedIncomeExpectedReturn` — a **held-to-maturity projection** for a tradable Bond/T-Bill, distinct from unrealized gain: capital gain/loss to face value at maturity, plus (Bond only) coupon interest accrued from each lot's purchase date to `maturity_date` at `interest_rate`. Returns `null` without lots, `face_value`, or `maturity_date`.

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

Models used: `claude-sonnet-5` (Claude), `llama-3.3-70b-versatile` (Groq). Both are defined in `MODEL_FOR_PROVIDER`.

All AI features (`src/lib/claude.ts`, `src/lib/autoThemes.ts`) call `createLLMClient(config.llmProvider, config.activeApiKey)` so they work with either provider.

### AI Command Bar

`src/lib/claude.ts` is the core AI feature. The command bar (⌘K / Cmd+K) collects natural language input and routes it through the LLM. File attachments (CSV, PDF, image) are parsed by `src/lib/fileParser.ts` and injected into the prompt. The agent runs a read-tool loop until a write or navigation tool is selected.

**Read tools** (loop freely, no confirmation):
- `get_portfolio_summary` — high-level net worth + allocation stats
- `get_positions` — detailed position rows
- `get_transactions` — tax lot details
- `get_net_worth_timeseries` — historical net worth snapshots
- `get_exposure_breakdown` — breakdown by ticker / theme / asset_type / location
- `analyze_tax_lots` — short/long-term capital gains analysis
- `simulate_portfolio_actions` — hypothetical what-if scenarios
- `recommend_actions_for_goal` — goal-based recommendations
- `get_rsu_vesting_schedule` — shares vesting between two dates, per grant (discrete installment math, not a smooth-curve estimate)

**Navigation tool** (no confirmation):
- `navigate_to` — routes to a page

**Write tools** (require user confirmation before executing):
- `add_stock_transaction` / `add_stock_transactions`
- `add_cash_asset` / `add_cash_assets` — for Bond/T-Bill, takes `count`/`cost_price`/`purchase_date` (the first lot) instead of `price`
- `add_fixed_income_lot` / `add_fixed_income_lots` — buy more units of an *existing* Bond/T-Bill position
- `add_ticker_to_watchlist`
- `add_ticker_themes`
- `add_rsu_grant` / `add_rsu_grants` — optional `vesting_frequency` (monthly/quarterly/annually/continuous), defaults to quarterly
- `sell_shares`
- `update_asset_value` — rejects Bond/T-Bill assets; their value is derived from lots, use `add_fixed_income_lot` instead

Write operations display a structured preview table in the UI before the user confirms. Multiple write tools in one agent turn are batched into a single confirmation dialog. Prefix commands with `mock:` to test the UI flow without making API or DB calls.

The command bar requires the user to be signed in; if not, it prompts re-authentication.

**File attachment support**: The command bar accepts CSV (text-injected), PDF (pdfjs-dist text extraction + base64 for Claude), and image files. Images require the Claude provider — switching to Groq while an image is attached will throw.

### In-App Alerts

`src/lib/appAlerts.ts` — lightweight pub/sub for transient toast-style notifications. `showAppAlert(message, options)` fires an event consumed by `AppAlertsHost.tsx`. Variants: `info`, `success`, `error`.

### Edge Functions

Four Deno functions in `supabase/functions/`:
- `send-push` — sends Web Push notifications via `npm:web-push`; requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` secrets
- `check-prices` — fetches Finnhub quotes, fires push if price moved ≥ user threshold
- `check-vests` — alerts on each discrete vest event (per grant's `vesting_frequency`) landing within `rsu_alert_days_before` days, not just the grant's final `vest_end`
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

`src/lib/importExport.ts` — full portfolio backup/restore, as an `.xlsx` workbook (one sheet per table: Locations, Tickers, Themes, TickerThemes, ThemeTargets, Assets, StockSubtypes, Transactions, RsuGrants, FixedIncomeLots, plus a Meta sheet). Accessible from Settings, which prompts for an `ExportScope` before exporting:
- `'assets'` ("Only assets") — the table bundle above.
- `'all'` ("All data") — the same bundle plus two more sheets: `NetWorthSnapshots` (from `net_worth_snapshots`) and `Conversations` (AI command bar history from `command_conversations`, flattened one row per message since a spreadsheet has no nesting).

Internally, `serializeForExport()` builds a schema-versioned canonical JS object (`mne.export.v2`) exactly as before; `buildExportWorkbook()` is the only new layer, turning each `data.*` array (plus `snapshots`/`conversations` for `'all'`) into a sheet with explicit, stable camelCase headers. Reading is the mirror image: `parseWorkbookImport()` reads the sheets back into that same canonical shape and feeds it through the existing `normalizeCanonicalExport()` row-normalization logic — so a sheet edited by hand in Excel round-trips the same way a hand-edited JSON field would. `importData()` still also accepts a legacy `mne.export.v2` JSON backup (detected by file extension/MIME type) via the original `parseImport()` path; scope-only sheets are simply absent/empty for a JSON import.

Asset dedup on import: before importing, `importData()` reads the signed-in user's existing assets and keys them by a natural key (asset type + name + location + ownership + ticker + fixed income subtype). An imported asset row matching that key is upserted onto the existing asset's id — re-importing the same backup (or one that dropped ids) updates positions in place instead of creating duplicates. Net worth snapshots dedup via the DB's `(user_id, date)` unique constraint; conversations dedup by id when the import row carries one (always true for `mne`'s own exports).

`abortActiveImport()` is called in `AppLayout` on unmount to cancel in-flight imports.

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

**Image attachments require Claude**: Attaching an image in the command bar throws if the active LLM provider is Groq. CSV and PDF work with both providers.

**`is_allowed_email_admin()` bypasses RLS intentionally**: The helper function is SECURITY DEFINER so it can query `allowed_emails` without triggering recursive policy evaluation. Don't remove this without replacing with a safe equivalent.

**RLS on new tables**: Every new Supabase table needs an explicit RLS policy or all writes silently fail with a policy violation. Check `supabase/migrations/` for the pattern used on existing tables.

**deleteAsset cascade**: There is no `ON DELETE CASCADE` at the DB level. `deleteAsset()` in `src/lib/db/assets.ts` manually deletes `transactions` → `rsu_grants` → `stock_subtypes`, and `fixed_income_lots`, before deleting the asset. Any new child tables added to `stock_subtypes` (or directly to `assets`, like `fixed_income_lots`) must be added to this function.

**Push notifications in production**: Requires `VITE_VAPID_PUBLIC_KEY` in `.env.local` and the three VAPID secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) set in Supabase dashboard → Settings → Edge Functions → Secrets.

**DB migrations**: Applied via Supabase MCP (`apply_migration` tool) or the Supabase dashboard SQL editor. There is no local Supabase CLI setup — all schema changes go directly to the hosted project. `supabase/sql/self_host_bootstrap.sql` is a standalone idempotent script used by `setup.sh` and `upgrade.sh` to initialize or upgrade a self-hosted Supabase project.

**Migration policy — keep bootstrap.sql in sync**: Every schema change must be reflected in BOTH `supabase/migrations/<timestamp>_<name>.sql` AND `supabase/sql/self_host_bootstrap.sql`. The bootstrap script is the source of truth for self-hosters; `upgrade.sh` re-runs it on every upgrade. Because the bootstrap uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `DROP COLUMN IF EXISTS` throughout, it is safe to re-run on any existing project at any version. New migrations that add columns should use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the bootstrap. Migrations that drop columns should use `DROP COLUMN IF EXISTS`. Migrations that rename or change column types need a compatible idempotent form (e.g. a DO block that checks for the old column and backfills before altering).

**`saveSettings` upsert**: Must include `{ onConflict: 'user_id' }` in the upsert call or updates silently fail with a unique constraint error when a row already exists.

**Missing `user_settings` columns**: A 400 from PostgREST on `/rest/v1/user_settings` often means a migration was never applied (column doesn't exist in DB), not a client bug. Check the response body for the actual column name.

**`gh` CLI not available**: `gh` is not installed. Create PRs via the GitHub web URL printed by `git push` instead.

**Notification edge functions**: Each `check-*` function reads `price_alerts_enabled` / `vest_alerts_enabled` / `capital_gains_alerts_enabled` from `user_settings` and skips push (but not DB promotion) when false.

**Adding a new LLM provider**: Add the provider type to `LLMProvider` in `src/store/config.ts`, add a case in `createLLMClient` in `src/lib/llm.ts`, add the model to `MODEL_FOR_PROVIDER`, add a key field to the config store, and add the `llm_provider` value + key column to `user_settings` via a migration and `self_host_bootstrap.sql`.

**OpenAI-format tool definitions**: All tools in `claude.ts` and `autoThemes.ts` use the OpenAI function-calling format (`{ type: 'function', function: { name, description, parameters } }`). `ClaudeAdapter` in `llm.ts` converts these to Anthropic format internally.
