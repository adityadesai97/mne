# mne

A personal finance tracker with AI-powered portfolio management. Built with React, Vite, Supabase, and configurable LLM providers.

---

## Using the hosted version

1. **Get access** — the app owner must add your email to the `allowed_emails` table in Supabase:
   ```sql
   insert into allowed_emails (email) values ('you@example.com');
   ```
2. **Sign in** — open the app and click "Continue with Google". Use the Google account matching your allowlisted email.
3. **Enter API keys** — on first sign-in you'll be asked for:
   - **One AI provider key**:
     - Claude — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
     - Groq — [console.groq.com/keys](https://console.groq.com/keys)
   - **Finnhub API key** — [finnhub.io/dashboard](https://finnhub.io/dashboard) (free tier is sufficient)
4. Done. Keys are stored in the database tied to your account and persist across devices.

---

## Self-hosting from scratch

This setup is intentionally scoped to:
- Supabase auth + database
- One AI provider key (Claude/Groq) and Finnhub user API keys
- Running the app locally

### 1. Prerequisites

| Dependency | Notes |
|------------|-------|
| Node.js `22.x` + npm | Required to build and run the app. Install from [nodejs.org](https://nodejs.org/en/download) or via [nvm](https://github.com/nvm-sh/nvm). |
| [Supabase](https://supabase.com) project | Free tier is sufficient. Provides the database and auth. |
| Google OAuth client | For sign-in via Supabase Auth. Create one in [Google Cloud Console](https://console.cloud.google.com). |
| AI provider key | One of: Claude ([console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)) or Groq ([console.groq.com/keys](https://console.groq.com/keys)). Entered in-app on first sign-in. |
| Finnhub API key | For stock price quotes. Free tier at [finnhub.io/dashboard](https://finnhub.io/dashboard). Entered in-app on first sign-in. |

### 2. Run setup

An interactive script handles dependency installation, `.env.local` creation, and walks you through all configuration options:

```bash
bash setup.sh
```

It will prompt for your Supabase credentials and ask whether to enable optional features (email allowlist, landing page, push notifications).

### 3. Apply the app schema in Supabase

In Supabase Dashboard → **SQL Editor**, paste and run the contents of:

```
supabase/sql/self_host_bootstrap.sql
```

This script is idempotent — safe to re-run. For CLI-based workflows, `supabase/migrations/20260302000000_baseline.sql` matches the same schema snapshot.

### 4. Enable Google sign-in in Supabase Auth

1. In Supabase: **Authentication → Providers → Google** → enable it.
2. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth 2.0 Web client:
   - Authorized JavaScript origin: `http://localhost:5173`
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Paste the Google client ID/secret into Supabase.

### 5. Start the app

```bash
bash run.sh
```

Open `http://localhost:5173`, sign in with Google, then enter your AI provider key and Finnhub key when prompted.

### 6. Optional allowlist (only if `VITE_RESTRICT_SIGNUPS=true`)

In Supabase SQL Editor:

```sql
insert into allowed_emails (email) values ('you@example.com');
```

### Upgrading an existing self-hosted instance

For ongoing updates (code + schema), follow:

- [`docs/self-host-upgrade.md`](docs/self-host-upgrade.md)

---

## Update workflows by persona

### 1) Hosted app users (your Supabase + Vercel project)

- End users only sign in and manage their own API keys in-app.
- You (operator) should release using:
  - [`docs/operator-release-runbook.md`](docs/operator-release-runbook.md)
- Best practice release order:
  1. Apply DB changes in Supabase.
  2. Deploy Supabase edge functions (if changed).
  3. Push app code to `main` and let Vercel auto-deploy.

### 2) Repo cloners (their own Supabase credentials)

- Clone the repo and follow the self-host setup steps above.
- For updates from upstream:
  1. Pull latest code.
  2. Apply DB updates (bootstrap SQL or new migrations).
  3. Restart/rebuild app.
- Detailed process:
  - [`docs/self-host-upgrade.md`](docs/self-host-upgrade.md)

---

## Deployment and update workflows

- Hosted operator release runbook: [`docs/operator-release-runbook.md`](docs/operator-release-runbook.md)
- Self-host upgrade guide: [`docs/self-host-upgrade.md`](docs/self-host-upgrade.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md)

## Managing access

When `VITE_RESTRICT_SIGNUPS=true`, only emails in the `allowed_emails` table can sign in.

To grant access (run in Supabase SQL Editor):
```sql
insert into allowed_emails (email) values ('user@example.com');
```

To revoke access:
```sql
delete from allowed_emails where email = 'user@example.com';
```

If `VITE_RESTRICT_SIGNUPS` is not set, anyone with a Google account can sign up.

---

## Commands

```bash
npm run dev      # start dev server on localhost:5173
npm run build    # production build
npm test         # run tests
npm run lint     # lint
```

## Import/Export JSON

`mne` now uses a canonical export format designed for round-trippable imports.

- `schema`: `mne.export.v2`
- `version`: `2.0`
- `exportedAt`: ISO timestamp
- `data`: normalized arrays keyed by IDs
  - `locations`
  - `themes`
  - `tickers`
  - `tickerThemes`
  - `themeTargets`
  - `assets`
  - `stockSubtypes`
  - `transactions`
  - `rsuGrants`

Minimal shape:

```json
{
  "schema": "mne.export.v2",
  "version": "2.0",
  "exportedAt": "2026-02-25T00:00:00.000Z",
  "data": {
    "locations": [],
    "themes": [],
    "tickers": [],
    "tickerThemes": [],
    "themeTargets": [],
    "assets": [],
    "stockSubtypes": [],
    "transactions": [],
    "rsuGrants": []
  }
}
```

Importer compatibility:
- Canonical `mne.export.v2` (preferred)
- Legacy `mne` nested export
- Moola export format

## Command Bar

Open with `Cmd+K`. Accepts natural language commands backed by your configured AI provider (e.g. "Add 10 AAPL shares at $220 bought today", "What's my net worth?").

### Dev commands

These bypass AI provider calls and operate directly on the database. Useful for testing and development.

| Command | Description |
|---------|-------------|
| `create:mock_data` | Seeds a full demo portfolio: AAPL (Market + ESPP), MSFT (Market + RSU with vested shares and an unvested grant), NVDA (Market), watchlist-only TSLA, Emergency Fund (Cash $25k), Vanguard 401k ($85k). |
| `delete:all_data` | Deletes all assets, stock positions, RSU grants, tickers, and locations for the current user. Irreversible. |
| `create:mock_notification:capital_gains` | Creates a Short Term lot just past the 1-year threshold and fires a Capital Gains push notification. Requires push notifications to be enabled. |
| `create:mock_notification:price_movement` | Creates a DEMO ticker whose price exceeds the user's alert threshold and fires a Price Movement push notification. Requires push notifications to be enabled. |
| `create:mock_notification:rsu_grant` | Creates a DEMO RSU grant vesting within the user's alert window and fires an RSU Vesting push notification. Requires push notifications to be enabled. |

All dev commands require confirmation before executing.

## Push Notifications

Scheduled edge functions run periodically to check for events:

- **check-capital-gains** — promotes Short Term lots over 1 year old to Long Term (daily, 9am)
- **check-prices** — alerts when a ticker moves beyond the user's price alert threshold (hourly)
- **check-vests** — alerts when an RSU grant is vesting within the user's configured window (hourly)

Configure thresholds in Settings → Notifications.
