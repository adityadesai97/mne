# mne

A personal finance tracker with AI-powered portfolio management. Built with React, Vite, Supabase, and Claude.

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

### 1. Create a Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Note the **Project URL** and **anon key** from **Project Settings → API**.

### 2. Apply the database schema

In the Supabase dashboard, open **SQL Editor** and run the contents of:

```
supabase/migrations/20260220000001_initial_schema.sql
```

### 3. Enable Google OAuth

1. In Supabase: **Authentication → Providers → Google** → enable it.
2. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth 2.0 Web client ID:
   - **Authorized JavaScript origins**: your app URL (e.g. `http://localhost:5173`)
   - **Authorized redirect URIs**: `https://<your-project>.supabase.co/auth/v1/callback`
3. Paste the Google **Client ID** and **Client Secret** into Supabase.

### 4. Configure environment variables

Create `.env.local` in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional: restrict sign-ups to an allowlist (see Managing access below)
VITE_RESTRICT_SIGNUPS=true

# Optional: show landing page as auth home (unset = classic sign-in page)
VITE_LANDING_AS_HOME=true
```

### 5. Install and run

```bash
npm install
npm run dev     # http://localhost:5173
```

### 6. (Optional) Push notifications

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys
```

Add to `.env.local`:

```env
VITE_VAPID_PUBLIC_KEY=<your public key>
```

Set these secrets in **Supabase Dashboard → Settings → Edge Functions → Secrets**:

| Secret | Value |
|--------|-------|
| `VAPID_PUBLIC_KEY` | your public key |
| `VAPID_PRIVATE_KEY` | your private key |
| `VAPID_SUBJECT` | `mailto:you@example.com` |

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

## GitHub Auto Deploy (main -> Vercel)

This repo includes `.github/workflows/main-test-and-deploy.yml`.
On every push to `main`, it:
1. runs `npm test -- --run`
2. deploys to Vercel production only if tests pass

Set these GitHub repository secrets for the workflow:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

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
