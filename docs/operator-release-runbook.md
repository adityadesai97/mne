# Hosted Operator Release Runbook

This runbook is for the app owner running production on their own Supabase + Vercel projects.

## Goals

- Keep schema and app code in sync.
- Avoid outages caused by deploying code before DB updates.
- Keep releases reproducible and auditable.

## Schema source of truth

- `supabase/sql/self_host_bootstrap.sql` is the canonical idempotent schema snapshot.
- `supabase/migrations/` contains `20260302000000_baseline.sql` plus future release migrations.
- This repository was rebaselined pre-release into a single baseline migration; future schema changes should be forward migrations.
- When adding a migration, update bootstrap SQL in the same PR.

## Release order (always)

1. Validate release locally.
2. Apply DB changes in Supabase.
3. Deploy/update edge functions (if changed).
4. Deploy app code to Vercel.
5. Run post-release smoke checks.

Never reverse steps 2 and 4.

## Pre-release checklist

1. Pull latest `main`.
2. Run:
   - `npm ci`
   - `npm run lint`
   - `npm run build`
   - `npx vitest --run`
3. Review changed files for:
   - `supabase/migrations/`
   - `supabase/functions/`
   - `.env` or secret requirements
4. Add release notes to `CHANGELOG.md` under `Unreleased`.

## Apply DB changes (production)

Choose one method.

- Method A (recommended when using Supabase CLI + linked project):
  1. Link project if needed: `supabase link --project-ref <project-ref>`
  2. Push migrations: `supabase db push`

- Method B (dashboard-only workflow):
  1. Run SQL for new migration files in Supabase SQL Editor.
  2. If schema cache errors appear, run: `notify pgrst, 'reload schema';`

For first-time or drifted environments, run the contents of:

- `supabase/sql/self_host_bootstrap.sql`

Do not run schema creation/migrations from Vercel build hooks. Build/deploy should be stateless; apply DB changes before app deploy.

## Deploy edge functions

If files changed under `supabase/functions/`, deploy them before app code.

Example:

```bash
supabase functions deploy send-push --project-ref <project-ref>
supabase functions deploy check-prices --project-ref <project-ref>
supabase functions deploy check-vests --project-ref <project-ref>
supabase functions deploy check-capital-gains --project-ref <project-ref>
```

## Deploy app code

1. Push to `main`.
2. Let Vercel deploy.
3. Verify environment variables are set in Vercel for production.

## Post-release smoke checks

1. Open production app and sign in.
2. Verify onboarding/settings load without PostgREST schema errors.
3. Verify core flows:
   - Add/edit/delete asset
   - Command bar action
   - Settings save
4. If push notifications are enabled, verify one check function invocation.

## Rollback policy

- App regression only: rollback Vercel deployment.
- DB migration regression: deploy a forward-fix migration (preferred) rather than destructive rollback.
- Keep migrations additive first, then remove deprecated columns/tables in a later release.

## Security and secret handling

- Never put service-role keys in client code.
- Keep Supabase and Vercel tokens in secret stores only.
- Rotate secrets immediately if leaked.

## Recommended CI secrets

For `.github/workflows/supabase-types-check.yml`:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_ID`
