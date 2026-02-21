# mne — Personal Finance App Design

**Date**: 2026-02-20
**Status**: Approved

---

## Overview

mne (pronounced "money") is a personal portfolio tracker PWA for iOS and macOS. It replaces the Moola iOS app with a cross-device, open-source alternative. All data lives in the user's own Supabase instance. Natural language commands are powered by a user-provided Claude API key.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Vite + React + TypeScript | Large ecosystem, best open-source contributor surface |
| UI Components | shadcn/ui + Tailwind CSS | Polished dark-mode components, fully customizable |
| Charts | Recharts | Composable, works well with React |
| Database | Supabase (Postgres) | Free tier, cross-device sync, Auth + Edge Functions included |
| AI | Anthropic JS SDK (`dangerouslyAllowBrowser: true`) | User-provided Claude API key, no backend needed |
| Stock Prices | Finnhub API | Free tier: 60 req/min real-time, sufficient for personal use |
| Push Notifications | Web Push API + Supabase Edge Functions + pg_cron | Serverless, within Supabase free tier |
| PWA | vite-plugin-pwa | Service worker + manifest for iOS/macOS install |

### User-Provided Keys (set during onboarding, never in code)

- Supabase project URL + anon key
- Claude API key
- Finnhub API key
- VAPID keys (auto-generated at setup, stored in Supabase secrets)

---

## Design System

**Aesthetic**: Dark, sleek, finance-forward — inspired by Cryptix (https://cryptix.framer.website/)

- **Background**: Near-black (`#0D0D0D`)
- **Surface**: Dark card (`#161616`)
- **Accent**: Neon green/mint — doubles as positive gain indicator
- **Typography**: Bold, large numerals for headline numbers; clean sans-serif throughout
- **Effects**: Subtle radial glow in accent color on hero sections
- **Mode**: Dark-first (light mode is a future enhancement)

---

## Screen Structure

Bottom tab bar navigation (mobile-first, works on iOS and macOS):

### Home
- Headline net worth number (large, bold)
- Expandable cards:
  - By asset type (Cash, Stocks, 401k, HSA, CD, Deposit)
  - By ownership (Individual / Joint)
  - By theme (AI, Technology, Crypto, etc.)
  - Unrealized gains / losses summary

### Portfolio
- All positions, grouped by asset type or theme (toggle)
- Each position card shows: current value, cost basis, unrealized gain/loss, gain %
- Expandable position detail:
  - Tax lots (count, cost price, purchase date, ST/LT status)
  - For CRM: subtypes (Market, ESPP, RSU grants with vesting schedule)
  - Notes

### Tax
- Short-term vs long-term gains summary
- Tax loss harvest candidates (positions where loss exceeds `tax_harvest_threshold`)
- Realized gains (from closed lots)

### Watchlist
- Tickers not currently owned
- Tagged by theme
- Current price (via Finnhub)

### Settings
- **Keys**: Claude API key, Finnhub API key, Supabase URL + anon key
- **Notifications**:
  - Price move alert threshold (% change, e.g. ±5%)
  - RSU vest reminder: days before (`rsu_alert_days_before`) — configurable, default 7 days
  - Toggle notifications on/off per type
- **Data**: Import JSON, Export JSON (Moola-compatible schema)

---

## Command Bar (⌘K)

Single-shot natural language commands. No persistent conversation.

**Read commands** → Claude interprets → navigates to the correct screen/filter
Examples:
- *"What's my AI theme exposure?"* → Portfolio filtered by AI theme
- *"Show my short-term tax lots"* → Tax screen, short-term view
- *"Which positions are down more than 10%?"* → Portfolio filtered by loss threshold

**Write commands** → Claude interprets → shows confirmation card → user confirms → committed to Supabase
Examples:
- *"I vested 14 CRM RSUs at $264 on Dec 22"* → confirmation card with parsed data
- *"Add 10 shares of AAPL at $220 bought today"* → confirmation card
- *"Update SPY price to 689"* → confirmation card

**Claude context**: Each command sends the current portfolio schema + relevant data as context. Claude returns a structured JSON action (navigate | write) that the app interprets.

---

## Data Model (Supabase Schema)

```sql
-- Core entities
assets            (id, name, asset_type, location_name, account_type, ownership, notes, ticker_id)
tickers           (id, symbol, current_price, last_updated)
stock_subtypes    (id, asset_id, subtype)           -- Market | ESPP | RSU
transactions      (id, subtype_id, count, cost_price, purchase_date, capital_gains_status)
rsu_grants        (id, subtype_id, grant_date, first_vest_date, cadence_months, unvested_count)

-- Theming & allocation
themes            (id, name)
ticker_themes     (ticker_id, theme_id)
theme_targets     (id, theme_id, target_percentage, is_active)

-- User config
user_settings     (
  id,
  claude_api_key,
  finnhub_api_key,
  price_alert_threshold,      -- % move that triggers a notification (e.g. 5.0)
  tax_harvest_threshold,      -- $ loss that flags a harvest candidate (e.g. 1000)
  rsu_alert_days_before       -- days before vest to notify (e.g. 7, configurable)
)

-- Push notifications
push_subscriptions (id, user_id, endpoint, p256dh, auth)
```

All tables protected by Supabase Row Level Security (RLS) tied to the authenticated user.

---

## Push Notifications

**Infrastructure**: Supabase Edge Functions + pg_cron (within free tier)

### Price Move Alerts (`check-prices` function)
- Schedule: `0 9,17 * * 1-5` (9am and 5pm on weekdays)
- Fetches current prices from Finnhub for all owned tickers
- Compares to `tickers.current_price` (last stored value)
- Sends push if `|change| >= price_alert_threshold`
- Updates stored price after check

### RSU Vest Reminders (`check-vests` function)
- Schedule: `0 8 * * *` (8am daily)
- Queries `rsu_grants` for grants where next vest date falls within `rsu_alert_days_before` days
- Sends push with grant name, shares vesting, and date
- Threshold is user-configurable in Settings

**iOS support**: Web Push requires PWA to be installed to home screen and iOS 16.4+.

---

## Onboarding Flow

First launch (no Supabase config detected):

1. Enter Supabase project URL + anon key
2. Sign in / create account (Supabase Auth, email + password)
3. Enter Claude API key
4. Enter Finnhub API key
5. Enable push notifications (browser permission prompt → subscription saved to Supabase)
6. Land on Home screen (empty state with prompt to add first asset or import JSON)

---

## Import / Export

- **Format**: JSON (matches Moola export schema for easy migration)
- **Import**: Parses JSON → shows preview → confirms → bulk-inserts to Supabase
- **Export**: Serializes all Supabase data → downloads as `mne-export-YYYY-MM-DD.json`
- Available in Settings → Data

---

## Out of Scope (for now)

- Light mode
- Multi-user / sharing
- Direct bank/brokerage connectivity (Plaid, etc.)
- Historical portfolio value charting (price history not stored)
- Tax form generation
