alter table user_settings
  add column if not exists price_alerts_enabled boolean not null default true,
  add column if not exists vest_alerts_enabled boolean not null default true,
  add column if not exists capital_gains_alerts_enabled boolean not null default true;
