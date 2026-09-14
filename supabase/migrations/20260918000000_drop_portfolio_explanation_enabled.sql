-- The Portfolio Performance Explanation is generated entirely on demand now
-- (see the on-demand rework migration/CLAUDE.md) — there's no background
-- generation left to opt in/out of, so the toggle is gone.

alter table public.user_settings drop column if exists portfolio_explanation_enabled;
