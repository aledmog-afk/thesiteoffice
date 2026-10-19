-- Rollback for v72 (Handover Part B — explicit handover confirmation
-- event + optional buyer/solicitor share link).
--
-- DDL-only, exactly like the v70/v71 rollbacks before it: this removes
-- the NEW objects v72 added and nothing else. It never touches
-- plots.handed_over_at (a pre-existing column from long before this
-- migration) or any value already written to it — a plot genuinely
-- confirmed as handed over via confirm_plot_handover() stays handed
-- over after this rollback runs; only the new confirmation/share
-- records and the RPCs that create them are removed. If that is not
-- what you want, do not run this against a database with any real
-- confirmations in it — back them up first.
--
-- Drop functions before tables (table drops would cascade-drop the
-- functions' dependent objects in the wrong order otherwise), and drop
-- the external RPC before the tables it reads.
drop function if exists public.get_plot_handover_share(text);
drop function if exists public.revoke_plot_handover_share(uuid);
drop function if exists public.request_plot_handover_share(uuid, text, text, integer);
drop function if exists public.confirm_plot_handover(uuid, text, jsonb, jsonb, text);

-- Dropping these tables also drops their indexes, RLS policies and
-- audit trigger automatically. Any plot_handover_confirmations/
-- plot_handover_shares rows that already exist are deleted by this —
-- that is the real, intended data loss of rolling back this migration
-- (the audit_log rows recording their original insert are untouched
-- and remain exactly as they are, per the same "never fabricate or
-- destroy audit history" principle v70/v71 followed).
drop table if exists public.plot_handover_shares;
drop table if exists public.plot_handover_confirmations;

drop function if exists public.plot_handover_share_token_hash(text);
