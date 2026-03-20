# Self-Host Upgrade Guide

## Quickstart

```bash
bash upgrade.sh
```

The script:
1. Pulls the latest code (`git pull --ff-only`)
2. Runs `npm ci`
3. Applies the database schema automatically via the Supabase Management API (prompts for a Personal Access Token; falls back to manual instructions)
4. Redeploys edge functions automatically if push notifications are set up (detected from `VITE_VAPID_PUBLIC_KEY` in `.env.local`)

---

## Manual steps (if you prefer not to use upgrade.sh)

### 1. Back up before upgrading

Use a DB backup/export process you trust for your Supabase project.

### 2. Pull code updates

```bash
git fetch --tags
git pull --ff-only
npm ci
```

If you prefer stable points, check out a release tag instead of `main`.

### 3. Apply DB updates

Two approaches — use whichever you started with.

**Approach A** (recommended): run the full bootstrap SQL — it's idempotent.
```
Supabase dashboard → SQL Editor → paste supabase/sql/self_host_bootstrap.sql → Run
```

**Approach B** (migration-driven): apply new files in `supabase/migrations/` since your last upgrade.

If you see schema-cache errors such as missing columns, run:

```sql
notify pgrst, 'reload schema';
```

### 4. Update edge functions (if using notifications)

When files under `supabase/functions/` change, redeploy functions using the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase login   # only needed once
supabase functions deploy send-push           --project-ref <project-ref>
supabase functions deploy check-prices        --project-ref <project-ref>
supabase functions deploy check-vests         --project-ref <project-ref>
supabase functions deploy check-capital-gains --project-ref <project-ref>
```

### 5. Build and run

```bash
npm run build
npm run dev
```

### 6. Verify

1. Sign in.
2. Open Settings and save once.
3. Run one command-bar action.
4. Add/edit one asset.

---

## Troubleshooting

### `Could not find the 'groq_api_key' column of 'user_settings'`

Your DB is behind the current schema. Re-run bootstrap SQL, then run:

```sql
notify pgrst, 'reload schema';
```

### Settings save fails after upgrade

Apply latest DB updates first. The app expects new columns before new features can persist.

### Should DB tables be created during `npm run build` or Vercel build?

No. Treat DB changes as an explicit operational step. Build pipelines should compile and test code only; schema changes should be applied separately before deploying app code.
