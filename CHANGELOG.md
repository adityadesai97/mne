# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `Crypto` asset type: held as fractional-unit tax lots (same ticker + lots model as stocks), priced from CoinGecko (keyless, or with an optional free Demo key) instead of Finnhub. Add via the command bar (`asset_class: 'Crypto'`) or the Watchlist's "Cryptocurrency" toggle; new `tickers.kind` / `tickers.coingecko_id` / `user_settings.coingecko_api_key` columns and widened price/quantity precision (migration `20260921000000`)
- `setup.sh` now automatically deploys edge functions, sets VAPID secrets, and configures pg_cron schedules when a Supabase Personal Access Token is provided
- `upgrade.sh` script for one-command upgrades: pulls code, applies schema, redeploys functions
- Inline documentation in `setup.sh` explaining every step and non-obvious decisions
- Migration policy documented in `CLAUDE.md` and `docs/self-host-upgrade.md`

### Changed
- Self-hosting setup now requires only `bash setup.sh` + Google OAuth for a full install including push notifications
- `docs/self-host-upgrade.md` restructured around `bash upgrade.sh` quickstart

---

## [1.0.0] — initial release

### Added
- Portfolio tracking: stocks (Market, ESPP, RSU), cash, 401k
- AI command bar (`Cmd+K`) backed by Claude or Groq
- Net worth history chart with configurable range
- Capital gains exposure and RSU vesting charts
- Watchlist and theme-based allocation tracking
- Push notifications: price alerts, RSU vesting alerts, capital gains promotion alerts
- Import/Export (mne.export.v2 format; also accepts legacy mne and Moola formats)
- Auto theme assignment via LLM
- Google OAuth via Supabase Auth
- Full RLS — every user sees only their own data

### Database
- Baseline schema in `supabase/migrations/20260302000000_baseline.sql`
- `supabase/sql/self_host_bootstrap.sql` — idempotent bootstrap for self-hosters
