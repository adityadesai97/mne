alter table public.user_settings
  add column if not exists auto_theme_assignment_enabled boolean not null default true;

update public.user_settings
set auto_theme_assignment_enabled = true
where auto_theme_assignment_enabled is null;
