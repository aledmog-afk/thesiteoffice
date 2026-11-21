-- v98 FORWARD MIGRATION. Early warning reasons.
--
-- No existing "sql/migrations/" directory or per-version standalone
-- FORWARD migration file existed in this repo before this one — only
-- the cumulative sql/schema.sql (the real source of truth, already
-- carries this same statement in its own v98 ADDITIONS section) and
-- sql/rollback/ (rollback-only, one file per version that has one).
-- This file is a newly-introduced convention, named to match
-- sql/rollback/'s vNN_<description>[_rollback].sql style, provided
-- because this task explicitly asked for the migration as its own
-- standalone file. Applying schema.sql already applies this; this
-- file exists so the one-line change can be reviewed/run on its own
-- too. Idempotent — safe to re-run, no backfill required.
--
-- Do NOT apply this to the live Supabase project. The product owner
-- applies it separately, once they approve it.

alter table public.weekly_reports add column if not exists early_warning_notes jsonb not null default '{}'::jsonb;
