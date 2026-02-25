# mne

A personal finance tracker with AI-powered portfolio management. Built with React, Vite, Supabase, and Claude.

---

## Using the hosted version

1. **Get access** — the app owner must add your email to the `allowed_emails` table in Supabase:
   ```sql
   insert into allowed_emails (email) values ('you@example.com');
   ```
2. **Sign in** — open the app and click "Continue with Google". Use the Google account matching your allowlisted email.
3. **Enter API keys** — on first sign-in you'll be asked for:
   - **Claude API key** — [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   - **Finnhub API key** — [finnhub.io/dashboard](https://finnhub.io/dashboard) (free tier is sufficient)
4. Done. Keys are stored in the database tied to your account and persist across devices.

---

## Self-hosting from scratch

This setup is intentionally scoped to:
- Supabase auth + database
- Claude and Finnhub user API keys
- Running the app locally

### 1. Prerequisites

- Node.js `22.x` and npm
- A Supabase project
- A Google OAuth client (for Supabase Auth)
- Claude API key ([console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
- Finnhub API key ([finnhub.io/dashboard](https://finnhub.io/dashboard))

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env.local`

```bash
cp .env.example .env.local
```

Then fill:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional flags:
- `VITE_RESTRICT_SIGNUPS=true` to require email allowlist
- `VITE_LANDING_AS_HOME=true` to show landing page before sign-in

`VITE_LANDING_AS_HOME` accepts boolean-like values:
- enabled: `true`, `1`, `yes`, `on`
- disabled: unset, `false`, `0`, `no`, `off`

### 4. Apply the app schema in Supabase

In Supabase Dashboard -> **SQL Editor**, run:

```
supabase/sql/self_host_bootstrap.sql
```

This bootstrap script is idempotent and aligns with the current app schema.

### 5. Enable Google sign-in in Supabase Auth

1. In Supabase: **Authentication -> Providers -> Google** -> enable it.
2. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth 2.0 Web client:
   - Authorized JavaScript origin: `http://localhost:5173`
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Paste the Google client ID/secret into Supabase.

### 6. Run the app

```bash
npm run dev
```

Open `http://localhost:5173`, sign in with Google, then enter your Claude and Finnhub keys in-app when prompted.

### 7. Optional allowlist (only if `VITE_RESTRICT_SIGNUPS=true`)

In Supabase SQL Editor:

```sql
insert into allowed_emails (email) values ('you@example.com');
```

---

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

## Command Bar

Open with `Cmd+K`. Accepts natural language commands backed by Claude (e.g. "Add 10 AAPL shares at $220 bought today", "What's my net worth?").

### Dev commands

These bypass Claude and operate directly on the database. Useful for testing and development.

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
