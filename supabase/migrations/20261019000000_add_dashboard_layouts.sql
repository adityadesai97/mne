-- Per-user Home / Charts card layout (order, hidden cards, column spans) as
-- { "home": [{ "id", "hidden"?, "span"? }], "charts": [...] }. Null = default layout.
alter table public.user_settings add column if not exists dashboard_layouts jsonb;
