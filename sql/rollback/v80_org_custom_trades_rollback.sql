-- v80 ROLLBACK. Drops public.add_org_custom_trade(uuid, text) and
-- public.org_custom_trades.
--
-- When to use: only if v80 itself turns out to cause a problem.
-- DESTRUCTIVE: dropping org_custom_trades deletes every custom trade
-- anyone has added across every organisation — they would need to be
-- re-typed via "+ Add new trade…" again. The fixed SNAG_TRADES list in
-- app.js (and any snag already saved with one of those custom trade
-- names in its own trade text column) is entirely unaffected; only the
-- "remembered for next time" convenience is lost.
--
-- Safe to run more than once (IF EXISTS is idempotent); no marker/
-- guard needed, since v80 never had a one-off go-live step to protect
-- against re-running.

drop function if exists public.add_org_custom_trade(uuid, text);
drop table if exists public.org_custom_trades;
