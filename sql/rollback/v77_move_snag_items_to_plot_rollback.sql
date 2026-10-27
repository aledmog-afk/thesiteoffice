-- v77 ROLLBACK. Drops public.move_snag_items_to_plot(uuid[], uuid).
--
-- When to use: only if v77 itself turns out to cause a problem. This
-- does NOT undo any data: the function only ever updates snag_items
-- rows one at a time (snag_list_id, plot_id, item_no) exactly the way
-- a direct client UPDATE already could — any items already moved stay
-- moved. Dropping the function just removes the one-call convenience
-- (and its automatic item_no renumbering); the underlying rows are
-- untouched.
--
-- Safe to run more than once (DROP FUNCTION IF EXISTS is idempotent);
-- no marker/guard needed, since v77 never had a one-off go-live step
-- to protect against re-running.

drop function if exists public.move_snag_items_to_plot(uuid[], uuid);
