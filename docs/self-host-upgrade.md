# Self-Host Upgrade Guide

This guide is for users running their own Supabase project after cloning the repository.

## Upgrade order (always)

1. Back up your database.
2. Pull code updates.
3. Apply DB updates.
4. Update edge functions (if used).
5. Build/restart app.
6. Verify core flows.

## 1. Back up before upgrading

Use a DB backup/export process you trust for your Supabase project.

## 2. Pull code updates

```bash
git fetch --tags
git pull --ff-only
npm ci
```

If you prefer stable points, check out a release tag instead of `main`.

## 3. Apply DB updates

Use one approach consistently.

- Approach A (safest for this repo): run the full bootstrap SQL each upgrade.
  - Open `supabase/sql/self_host_bootstrap.sql`.
  - Run its contents in Supabase SQL Editor.
  - It is idempotent (`create/alter ... if not exists`).

- Approach B (migration-driven): apply all new files in `supabase/migrations/` since your last upgrade.

If you see schema-cache errors such as missing columns, run:

```sql
notify pgrst, 'reload schema';
```

## 4. Update edge functions (if using notifications)

When files under `supabase/functions/` change, redeploy functions.

```bash
supabase functions deploy send-push --project-ref <project-ref>
supabase functions deploy check-prices --project-ref <project-ref>
supabase functions deploy check-vests --project-ref <project-ref>
supabase functions deploy check-capital-gains --project-ref <project-ref>
```

## 5. Build and run

```bash
npm run build
npm run dev
```

## 6. Verify

1. Sign in.
2. Open Settings and save once.
3. Run one command-bar action.
4. Add/edit one asset.

## Troubleshooting

### `Could not find the 'groq_api_key' column of 'user_settings'`

Your DB is behind the current schema. Re-run bootstrap SQL, then run:

```sql
notify pgrst, 'reload schema';
```

### Settings save fails after upgrade

Apply latest DB updates first. The app expects new columns before new features can persist.
