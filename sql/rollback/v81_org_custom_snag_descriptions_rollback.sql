-- v81 ROLLBACK. Drops public.add_org_custom_snag_description(uuid, text)
-- and public.org_custom_snag_descriptions.
--
-- When to use: only if v81 itself turns out to cause a problem.
-- DESTRUCTIVE: dropping org_custom_snag_descriptions deletes every
-- saved "quick-add" description anyone has added across every
-- organisation — they would need to be saved again. Every snag's own
-- description text column (saved from one of these or typed fresh) is
-- entirely unaffected; only the "remembered for next time" quick-fill
-- convenience is lost.
--
-- Safe to run more than once (IF EXISTS is idempotent); no marker/
-- guard needed, since v81 never had a one-off go-live step to protect
-- against re-running.

drop function if exists public.add_org_custom_snag_description(uuid, text);
drop table if exists public.org_custom_snag_descriptions;
