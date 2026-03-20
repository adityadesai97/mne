# mne

A personal finance tracker with AI-powered portfolio management. Built with React, Vite, Supabase, and configurable LLM providers.

---

## Setup

### Hosted version

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

### Self-hosting

#### Prerequisites

| Dependency | Notes |
|------------|-------|
| Node.js `22.x` + npm | Install from [nodejs.org](https://nodejs.org/en/download) or via [nvm](https://github.com/nvm-sh/nvm). |
| [Supabase](https://supabase.com) project | Free tier is sufficient. Provides the database and auth. |
| Google OAuth client | For sign-in via Supabase Auth. Create one in [Google Cloud Console](https://console.cloud.google.com). |
| AI provider key | Claude ([console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)) or Groq ([console.groq.com/keys](https://console.groq.com/keys)). Entered in-app on first sign-in. |
| Finnhub API key | For stock price quotes. Free tier at [finnhub.io/dashboard](https://finnhub.io/dashboard). Entered in-app on first sign-in. |

#### 1. Run setup

```bash
bash setup.sh
```

This interactive script handles everything in one go:
- Installs dependencies
- Prompts for your Supabase credentials and writes `.env.local`
- Asks whether to enable optional features (email allowlist, landing page, push notifications)
- Offers to apply the database schema automatically via the Supabase Management API (requires a [Personal Access Token](https://supabase.com/dashboard/account/tokens)); falls back to manual instructions if you skip it

#### 2. Enable Google sign-in

1. In Supabase: **Authentication → Providers → Google** → enable it.
2. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth 2.0 Web client:
   - Authorized JavaScript origin: `http://localhost:5173`
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Paste the Google client ID and secret into Supabase.

#### 3. Start the app

```bash
bash run.sh
```

Open `http://localhost:5173`, sign in with Google, then enter your AI provider key and Finnhub key when prompted.

#### Upgrading an existing instance

See [`docs/self-host-upgrade.md`](docs/self-host-upgrade.md).

---

## Features

### AI Command Bar

Open with `Cmd+K`. Type natural language commands backed by your configured AI provider:

> "Add 10 AAPL shares at $220 bought today"
> "What's my net worth?"
> "Show my capital gains exposure"

The agent reads your portfolio data, then proposes write operations (adding positions, updating values, etc.) for you to confirm before anything is saved. Attach a `.csv` or `.pdf` file to parse financial statements directly.

#### Dev commands

Bypass AI and operate directly on the database. Useful for testing.

| Command | Description |
|---------|-------------|
| `create:mock_data` | Seeds a full demo portfolio: AAPL (Market + ESPP), MSFT (Market + RSU with vested shares and an unvested grant), NVDA (Market), watchlist-only TSLA, Emergency Fund (Cash $25k), Vanguard 401k ($85k). |
| `delete:all_data` | Deletes all assets, stock positions, RSU grants, tickers, and locations for the current user. Irreversible. |
| `create:mock_notification:capital_gains` | Creates a Short Term lot just past the 1-year threshold and fires a Capital Gains push notification. Requires push notifications to be enabled. |
| `create:mock_notification:price_movement` | Creates a DEMO ticker whose price exceeds the user's alert threshold and fires a Price Movement push notification. Requires push notifications to be enabled. |
| `create:mock_notification:rsu_grant` | Creates a DEMO RSU grant vesting within the user's alert window and fires an RSU Vesting push notification. Requires push notifications to be enabled. |

All dev commands require confirmation before executing.

### Push Notifications

Scheduled edge functions check for events and send browser push alerts:

- **Price alerts** — fires when a tracked ticker moves beyond your configured threshold (checked hourly)
- **RSU vesting alerts** — fires when a grant is vesting within your configured window (checked hourly)
- **Capital gains alerts** — fires when a Short Term lot crosses the 1-year mark and is promoted to Long Term (checked daily at 9am)

Configure thresholds in Settings → Notifications.

### Import / Export

Full portfolio backup and restore via JSON. Accessible from Settings.

Export format `mne.export.v2` — a normalized snapshot of all your positions, tickers, themes, and locations. The importer also accepts the legacy `mne` nested format and Moola exports.

### Managing access

When `VITE_RESTRICT_SIGNUPS=true`, only emails in the `allowed_emails` table can sign in.

To grant access (run in Supabase SQL Editor):
```sql
insert into allowed_emails (email) values ('user@example.com');
```

To revoke:
```sql
delete from allowed_emails where email = 'user@example.com';
```

---

## Commands

```bash
npm run dev      # start dev server on localhost:5173
npm run build    # production build
npm test         # run tests
npm run lint     # lint
```

## Deployment

- Operator release runbook: [`docs/operator-release-runbook.md`](docs/operator-release-runbook.md)
- Self-host upgrade guide: [`docs/self-host-upgrade.md`](docs/self-host-upgrade.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md)
