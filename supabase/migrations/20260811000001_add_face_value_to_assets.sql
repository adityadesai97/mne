-- Adds Treasury Bill (T-Bill) as a Fixed Income subtype, and a face_value
-- column to record the amount paid out at maturity for instruments that
-- sell at a discount (T-Bills, and any Bond bought below par) rather than
-- accruing periodic interest. assets.price continues to hold the
-- discounted amount actually paid for the instrument.
alter table public.assets add column if not exists face_value numeric(12,4);

alter table public.assets drop constraint if exists assets_fixed_income_subtype_check;
alter table public.assets
  add constraint assets_fixed_income_subtype_check
  check (fixed_income_subtype is null or fixed_income_subtype in ('CD', 'Deposit', 'Bond', 'T-Bill'));
