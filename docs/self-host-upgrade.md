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

**How schema upgrades work:** This project uses a single idempotent bootstrap script rather than tracked migrations. `supabase/sql/self_host_bootstrap.sql` is kept in sync with every schema change and can be re-run on any existing project at any version — it uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `DROP COLUMN IF EXISTS` throughout. Running it on an already-current project is a no-op.

**Approach A** (recommended): re-run the full bootstrap SQL.
```
Supabase dashboard → SQL Editor → paste supabase/sql/self_host_bootstrap.sql → Run
```
This is what `upgrade.sh` does automatically when a PAT is provided.

**Approach B** (migration-driven): apply only the new files in `supabase/migrations/` added since your last upgrade. Each file in that directory is also idempotent. Check the file timestamps against your last upgrade date.

If you see schema-cache errors after applying changes, run:

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
