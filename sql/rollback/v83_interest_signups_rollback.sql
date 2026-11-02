-- v83 ROLLBACK. Drops public.interest_signups.
--
-- When to use: only if v83 itself turns out to cause a problem.
-- DESTRUCTIVE: dropping interest_signups deletes every "Register your
-- interest" submission from the public front page. Nothing else in
-- the app reads or depends on this table — it exists purely to record
-- these submissions for Aled to review.
--
-- Also undeploy the supabase/functions/register-interest edge
-- function itself (not something this SQL file can do) — otherwise it
-- would keep accepting submissions that silently fail to insert once
-- this table is gone.
--
-- Safe to run more than once (IF EXISTS is idempotent); no marker/
-- guard needed, since v83 never had a one-off go-live step to protect
-- against re-running.

drop table if exists public.interest_signups;
