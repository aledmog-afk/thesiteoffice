-- v88 ROLLBACK. Drops drawing_pins.drawing_id and its index, and
-- reverts drawing_pins_before_insert() to its pre-v88 (v74) body.
--
-- When to use: only if v88 itself turns out to cause a problem.
-- DESTRUCTIVE in one narrow sense: every pin's drawing_id — including
-- the v88 backfill's own work — is lost; the drawing_pins rows
-- themselves are NOT deleted, just this one column. Nothing else in
-- the app depends on drawing_id once this is reverted, since
-- drawing-view.html/snag-list-edit.html/app.js would all need
-- reverting alongside this (they stop passing/expecting drawing_id
-- the moment this PR's code changes are rolled back too — this script
-- only undoes the schema half).
--
-- Reinstates the exact pre-v88 trigger body: no drawing_id checks, no
-- drawing_page_assignments-linkage check against drawing_id — back to
-- validating only drawing_page_id, exactly-one-owner, and
-- same-project-as-pinned-item.
--
-- Safe to run more than once (IF EXISTS / CREATE OR REPLACE are
-- idempotent throughout).

create or replace function public.drawing_pins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page_project_id uuid;
  v_owner_project_id uuid;
  v_owner_count int;
begin
  v_owner_count := (new.snag_item_id is not null)::int + (new.rfi_id is not null)::int +
                    (new.quality_gate_id is not null)::int + (new.query_id is not null)::int;
  if v_owner_count <> 1 then
    raise exception 'drawing_pins: exactly one of snag_item_id/rfi_id/quality_gate_id/query_id must be set, got %', v_owner_count;
  end if;

  select project_id into v_page_project_id from public.drawing_pages where id = new.drawing_page_id;
  if v_page_project_id is null then
    raise exception 'drawing_pins.drawing_page_id must reference an existing drawing_pages row';
  end if;
  new.project_id := v_page_project_id;

  if new.snag_item_id is not null then
    select project_id into v_owner_project_id from public.snag_items where id = new.snag_item_id;
  elsif new.rfi_id is not null then
    select project_id into v_owner_project_id from public.rfis where id = new.rfi_id;
  elsif new.quality_gate_id is not null then
    select project_id into v_owner_project_id from public.quality_gates where id = new.quality_gate_id;
  elsif new.query_id is not null then
    select project_id into v_owner_project_id from public.general_queries where id = new.query_id;
  end if;
  if v_owner_project_id is null or v_owner_project_id <> v_page_project_id then
    raise exception 'drawing_pins: the pinned item must exist in the same project as the drawing page';
  end if;

  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

drop index if exists public.drawing_pins_drawing_idx;
alter table public.drawing_pins drop column if exists drawing_id;
