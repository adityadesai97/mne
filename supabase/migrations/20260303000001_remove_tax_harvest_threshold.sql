-- Remove unused capital gains threshold setting.
alter table public.user_settings
  drop column if exists tax_harvest_threshold;
