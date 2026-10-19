-- Rollback for v74 (drawing pins: site/plot/block storey drawings,
-- PDF page rasterisation, pins on snags/RFIs/quality gates/general
-- queries), and the retirement of the old v1-era drawings/pin-columns
-- system it replaced.
--
-- DDL-only, like every rollback before it in this file — but unlike
-- v70-v73 this one also UNDOES A TABLE DROP (the old `drawings` table
-- and the three pin columns v74 removed from snag_items/
-- quality_gates), not just a constraint. That restoration is
-- structure-only: the old table/columns come back EMPTY, with no
-- data in them, because v74 only ever dropped them after confirming
-- (by a live read, 19 Oct 2026 — see handover/NOTES.md) that they had
-- zero rows at the time. If that's no longer true when this rollback
-- actually runs — i.e. the new drawing_pins/drawings/general_queries
-- tables now hold real content from using this feature — this script
-- REFUSES rather than silently discarding it. Decide what should
-- happen to that data first (there is no automatic way to translate a
-- v74 pin on a specific drawing_page back into the old table's single
-- flat x_coordinate/y_coordinate-on-a-drawing shape; they are not
-- equivalent models) before running this.

-- Checks all six tables, not just drawings/drawing_pins/general_queries
-- — an uploaded-but-not-yet-assigned drawing_upload/drawing_page is
-- still real content (a real file someone uploaded), and a superseded
-- drawing_page_assignments row is still real history, not disposable
-- just because nothing currently points at it as "current".
do $$
declare
  v_upload_count bigint;
  v_page_count bigint;
  v_drawing_count bigint;
  v_assignment_count bigint;
  v_query_count bigint;
  v_pin_count bigint;
begin
  select count(*) into v_upload_count from public.drawing_uploads;
  select count(*) into v_page_count from public.drawing_pages;
  select count(*) into v_drawing_count from public.drawings;
  select count(*) into v_assignment_count from public.drawing_page_assignments;
  select count(*) into v_query_count from public.general_queries;
  select count(*) into v_pin_count from public.drawing_pins;
  if v_upload_count > 0 or v_page_count > 0 or v_drawing_count > 0
     or v_assignment_count > 0 or v_query_count > 0 or v_pin_count > 0 then
    raise exception 'v74 rollback refused: % drawing_uploads, % drawing_pages, % drawings, '
      '% drawing_page_assignments, % general_queries, % drawing_pins row(s) exist. '
      'This rollback only restores the pre-v74 schema structure, not data — the old and new '
      'pinning models are not equivalent and there is no automatic translation. Decide what '
      'should happen to this data before rolling back.',
      v_upload_count, v_page_count, v_drawing_count, v_assignment_count, v_query_count, v_pin_count;
  end if;
end $$;

-- ─── Drop everything v74 added, in dependency order ─────────────────
drop trigger if exists trg_audit_drawing_pins on public.drawing_pins;
drop trigger if exists trg_audit_general_queries on public.general_queries;
drop trigger if exists trg_audit_drawing_page_assignments on public.drawing_page_assignments;
drop trigger if exists trg_audit_drawings on public.drawings;
drop trigger if exists trg_audit_drawing_pages on public.drawing_pages;
drop trigger if exists trg_audit_drawing_uploads on public.drawing_uploads;

drop table if exists public.drawing_pins;
drop table if exists public.general_queries;
drop table if exists public.drawing_page_assignments;
drop table if exists public.drawings;
drop table if exists public.drawing_pages;
drop table if exists public.drawing_uploads;

drop function if exists public.drawing_pins_before_insert();
drop function if exists public.general_queries_before_write();
drop function if exists public.drawing_page_assignments_after_insert();
drop function if exists public.drawing_page_assignments_before_insert();
drop function if exists public.drawings_before_write();
drop function if exists public.drawing_pages_before_insert();
drop function if exists public.drawing_uploads_before_insert();

-- ─── Restore the pre-v74 can_read_audit_row() (drop the six new
-- table names from its member-level bucket) ──────────────────────────
create or replace function public.can_read_audit_row(p_table_name text, p_project_id uuid, p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_table_name = 'org_settings' then
    return p_org_id is not null and public.is_org_member(p_org_id);
  end if;

  if p_table_name = 'toolbox_talk_templates' then
    return p_org_id is not null and public.is_org_member(p_org_id);
  end if;

  if p_project_id is null then
    return false;
  end if;

  if p_table_name in ('commercial_events', 'commercial_line_items', 'variations', 'dayworks', 'variation_dayworks',
                      'commercial_evidence_links', 'commercial_signatures', 'commercial_approval_requests', 'commercial_items') then
    return public.can_see_commercial_prices(p_project_id);
  end if;

  if p_table_name in ('projects', 'snag_items', 'documents', 'document_revisions', 'toolbox_talks', 'toolbox_talk_attendees') then
    return public.is_project_member(p_project_id);
  end if;

  return public.is_project_editor(p_project_id);
end;
$$;

-- ─── Restore the old v1-era drawings table and pin columns, EMPTY ───
-- (structure only, per the data-loss guard above — nothing here can
-- ever be populated by this rollback). Identical to the table's
-- original shape at the top of sql/schema.sql, including its original
-- "any authenticated user" RLS, exactly as it stood before v74.
create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_number text,
  drawing_name text not null,
  drawing_url text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.drawings enable row level security;
drop policy if exists "authenticated read drawings" on public.drawings;
create policy "authenticated read drawings" on public.drawings for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert drawings" on public.drawings;
create policy "authenticated insert drawings" on public.drawings for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update drawings" on public.drawings;
create policy "authenticated update drawings" on public.drawings for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete drawings" on public.drawings;
create policy "authenticated delete drawings" on public.drawings for delete using (auth.role() = 'authenticated');

alter table public.snag_items add column if not exists drawing_id uuid references public.drawings(id) on delete set null;
alter table public.snag_items add column if not exists x_coordinate numeric check (x_coordinate >= 0 and x_coordinate <= 100);
alter table public.snag_items add column if not exists y_coordinate numeric check (y_coordinate >= 0 and y_coordinate <= 100);

alter table public.quality_gates add column if not exists drawing_id uuid references public.drawings(id) on delete set null;
alter table public.quality_gates add column if not exists x_coordinate numeric check (x_coordinate >= 0 and x_coordinate <= 100);
alter table public.quality_gates add column if not exists y_coordinate numeric check (y_coordinate >= 0 and y_coordinate <= 100);
