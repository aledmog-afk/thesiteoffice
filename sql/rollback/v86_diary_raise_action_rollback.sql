-- v86 ROLLBACK. Drops actions.source_diary_entry_id and its index.
--
-- When to use: only if v86 itself turns out to cause a problem.
-- DESTRUCTIVE in one narrow sense: any Action's link back to the diary
-- entry that raised it is lost (the Action row itself is NOT deleted —
-- the column is just dropped, same as the data it held). Nothing else
-- in the app reads or depends on this column.
--
-- Safe to run more than once (IF EXISTS is idempotent throughout).

drop index if exists public.actions_source_diary_entry_idx;
alter table public.actions drop column if exists source_diary_entry_id;
