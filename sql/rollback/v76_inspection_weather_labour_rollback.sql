-- v76 ROLLBACK. Drops the five columns v76 added to public.inspections
-- (weather_conditions, labour_records, plant_records, accompanied_by,
-- overall_result) and their check constraint.
--
-- When to use: only if v76 itself turns out to cause a problem. This
-- DOES discard data: any weather/labour/plant/accompanied-by/overall-
-- result value entered on any inspection since v76 went live is
-- permanently lost the moment this runs (the columns, and everything
-- in them, are dropped). Nothing else reads or depends on these five
-- columns — no other table, trigger, or live figure is computed from
-- any of them — so nothing else is affected by running this.
--
-- Safe to run more than once (every statement uses IF EXISTS); there
-- is no marker/guard needed the way v69/v75's rollback requires one,
-- because v76 has no one-off go-live side effect to protect against
-- re-running (it only ever added nullable/empty-default columns, never
-- carried any existing live figure over).

alter table public.inspections drop constraint if exists inspections_overall_result_check;
alter table public.inspections drop column if exists overall_result;
alter table public.inspections drop column if exists accompanied_by;
alter table public.inspections drop column if exists plant_records;
alter table public.inspections drop column if exists labour_records;
alter table public.inspections drop column if exists weather_conditions;
