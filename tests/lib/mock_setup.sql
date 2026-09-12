-- Mock Supabase environment for testing sql/schema.sql against a plain
-- PostgreSQL instance (local dev, or the `postgres:` service container in
-- CI — see .github/workflows/test.yml). Reconstructs just enough of
-- auth.* and storage.* for the schema to apply cleanly and for RLS/storage
-- policies to be exercised as a real, non-superuser `authenticated` role —
-- never as the superuser applying the schema, which bypasses RLS entirely
-- and would make every security test a false positive.
--
-- This is NOT a Supabase emulator: it does not reproduce Supabase Storage's
-- HTTP API, so bucket-level file_size_limit/allowed_mime_types enforcement
-- (Priority 2) can only be verified by inspecting the bucket row's config
-- here, not by a real upload attempt — see tests/security/storage.test.mjs
-- for how that boundary is documented and tested.

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- auth.uid(): reads the caller's id from a session GUC, set per-query via
-- `set local request.jwt.claim.sub = '<uuid>'` (see tests/lib/db.mjs).
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- auth.role(): real Supabase reads this from the JWT; here it just
-- reflects the actual Postgres role the session switched to via
-- `set role authenticated`, which is all schema.sql's
-- `auth.role() = 'authenticated'` checks need.
create or replace function auth.role() returns text
language sql stable
as $$
  select current_user::text;
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Real Supabase provides this; reconstructed here so RLS policies that
-- parse object paths (storage.foldername(name)) behave the same way in
-- tests as they do against the real project.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end;
$$;

-- A real, non-superuser role standing in for Supabase's `authenticated`
-- Postgres role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema storage to authenticated;
grant select on all tables in schema auth to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
