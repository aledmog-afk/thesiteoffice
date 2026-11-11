-- v91 ROLLBACK. Drops public.platform_admins, is_platform_admin(), and
-- the platform-admin SELECT policy on interest_signups.
--
-- When to use: only if v91 itself turns out to cause a problem.
-- DESTRUCTIVE in one sense: the platform_admins table itself is
-- dropped, so whoever Aled added there by hand is lost and would need
-- re-adding after a forward-fix. Nothing else in the app reads or
-- depends on platform_admins or is_platform_admin() — this was built
-- as a new, narrow primitive specifically for the invite-a-customer
-- feature, not retrofitted onto anything existing.
--
-- Also undeploy the supabase/functions/invite-customer edge function
-- itself (not something this SQL file can do) — otherwise it would
-- keep calling is_platform_admin() via RPC, which would then fail
-- with "function does not exist" instead of a clean 403, and have no
-- service-role action to perform regardless once that call errors.
--
-- interest_signups itself is NOT dropped or altered beyond removing
-- the one policy added here — it reverts to exactly its v83 shape
-- (RLS enabled, zero policies, anon/authenticated fully revoked).
--
-- Safe to run more than once (IF EXISTS / DROP POLICY IF EXISTS are
-- idempotent throughout).

drop policy if exists "platform admins read interest_signups" on public.interest_signups;
revoke select on table public.interest_signups from authenticated;

drop function if exists public.is_platform_admin();
drop table if exists public.platform_admins;
