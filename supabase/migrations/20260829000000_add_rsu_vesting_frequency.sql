-- RSU grants previously had no way to record how a grant actually vests —
-- only its start/end dates and total shares — so every screen that shows
-- vesting progress (the RSU chart, vest-alert notifications, and the
-- command bar's vesting-schedule tool) had to guess the shape of the curve
-- between vest_start and vest_end, and guessed smooth/continuous, which
-- doesn't match how real equity plans vest (discrete monthly/quarterly/
-- annual installments). This adds an explicit cadence per grant.
--
-- Existing grants are backfilled to 'quarterly' by the NOT NULL DEFAULT
-- below — the most common real-world schedule (cliff + equal quarterly
-- installments) and confirmed correct against an actual user's brokerage
-- statement.
alter table public.rsu_grants
  add column if not exists vesting_frequency text not null default 'quarterly';

alter table public.rsu_grants drop constraint if exists rsu_grants_vesting_frequency_check;
alter table public.rsu_grants
  add constraint rsu_grants_vesting_frequency_check
  check (vesting_frequency in ('monthly', 'quarterly', 'annually', 'continuous'));
