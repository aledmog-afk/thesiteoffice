-- v85 ROLLBACK. Drops the personal diary, site diary (same table,
-- filtered — nothing extra to drop), general/site meeting notes,
-- the weekly-report diary pull-in child table, and the new
-- actions.source_meeting_note_id column. Restores write_audit_log()
-- and can_read_audit_row() and site_photos_authorized()/
-- site_photos_read_authorized() to their pre-v85 shape.
--
-- When to use: only if v85 itself turns out to cause a problem.
-- DESTRUCTIVE: dropping personal_diary_entries/org_meeting_notes/
-- project_meeting_notes/weekly_report_diary_entries deletes every
-- diary entry, meeting note and attached-diary-entry snapshot ever
-- written. Nothing else in the app reads or depends on these tables.
--
-- Safe to run more than once (IF EXISTS is idempotent throughout).

drop trigger if exists trg_audit_weekly_report_diary_entries on public.weekly_report_diary_entries;
drop trigger if exists trg_audit_project_meeting_notes on public.project_meeting_notes;
drop trigger if exists trg_audit_org_meeting_notes on public.org_meeting_notes;

drop function if exists public.get_unattached_diary_entries(uuid, date, date);

drop trigger if exists trg_weekly_report_diary_entries_before_delete on public.weekly_report_diary_entries;
drop function if exists public.weekly_report_diary_entries_before_delete();
drop trigger if exists trg_weekly_report_diary_entries_before_write on public.weekly_report_diary_entries;
drop function if exists public.weekly_report_diary_entries_before_write();
drop table if exists public.weekly_report_diary_entries;

alter table public.actions drop column if exists source_meeting_note_id;

drop trigger if exists trg_project_meeting_notes_before_write on public.project_meeting_notes;
drop function if exists public.project_meeting_notes_before_write();
drop table if exists public.project_meeting_notes;

drop trigger if exists trg_org_meeting_notes_before_write on public.org_meeting_notes;
drop function if exists public.org_meeting_notes_before_write();
drop table if exists public.org_meeting_notes;

drop trigger if exists trg_personal_diary_entries_before_write on public.personal_diary_entries;
drop function if exists public.personal_diary_entries_before_write();
drop table if exists public.personal_diary_entries;

drop function if exists public.is_contractor_side_editor(uuid);

-- Restores the v58 shape (no "diary" branch, no org_meeting_notes
-- branch) — see those sections of sql/schema.sql for the originals.
create or replace function public.site_photos_authorized(object_name text)
returns boolean
language plpgsql stable
as $$
declare
  parts record;
begin
  if (storage.foldername(object_name))[1] = 'org-logo' then
    return exists (select 1 from public.organisation_members where user_id = auth.uid());
  end if;

  select * into parts from public.site_photos_path_parts(object_name);
  if parts.project_id is null then
    return false;
  end if;

  if parts.area = 'snags' then
    return public.is_project_member(parts.project_id);
  end if;

  return public.is_project_editor(parts.project_id);
end;
$$;

create or replace function public.site_photos_read_authorized(object_name text)
returns boolean
language plpgsql stable
security definer
set search_path = public
as $$
declare
  parts record;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or object_name is null then
    return false;
  end if;

  if (storage.foldername(object_name))[1] = 'org-logo' then
    return exists (
      select 1
      from public.org_settings os
      where public.site_photos_ref_to_path(os.logo_url) = object_name
        and (
          exists (select 1 from public.organisation_members om
                  where om.org_id = os.org_id and om.user_id = v_uid)
          or exists (select 1 from public.projects p
                     join public.project_members pm on pm.project_id = p.id
                     where p.org_id = os.org_id and pm.user_id = v_uid)
        )
    );
  end if;

  select * into parts from public.site_photos_path_parts(object_name);
  if parts.project_id is null then
    return false;
  end if;

  return public.is_project_member(parts.project_id);
end;
$$;

create or replace function public.write_audit_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_record jsonb := to_jsonb(coalesce(new, old));
  v_record_id uuid;
  v_project_id uuid;
  v_org_id uuid;
begin
  if TG_TABLE_NAME = 'projects' then
    v_record_id := (v_record->>'id')::uuid;
    v_project_id := case when TG_OP = 'DELETE' then null else v_record_id end;
    v_org_id := (v_record->>'org_id')::uuid;
  elsif TG_TABLE_NAME = 'org_settings' then
    v_project_id := null;
    v_org_id := (v_record->>'org_id')::uuid;
    v_record_id := v_org_id;
  elsif TG_TABLE_NAME = 'toolbox_talk_templates' then
    v_record_id := (v_record->>'id')::uuid;
    v_project_id := null;
    v_org_id := (v_record->>'org_id')::uuid;
  else
    v_record_id := (v_record->>'id')::uuid;
    v_project_id := (v_record->>'project_id')::uuid;
    select org_id into v_org_id from public.projects where id = v_project_id;
    if not found then
      v_project_id := null;
      v_org_id := null;
    end if;
  end if;

  insert into public.audit_log (org_id, project_id, user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_org_id,
    v_project_id,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    v_record_id,
    case when TG_OP = 'INSERT' then null else to_jsonb(old) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$function$;

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

  if p_table_name in ('projects', 'snag_items', 'documents', 'document_revisions', 'toolbox_talks', 'toolbox_talk_attendees',
                      'drawing_uploads', 'drawing_pages', 'drawings', 'drawing_page_assignments', 'general_queries', 'drawing_pins') then
    return public.is_project_member(p_project_id);
  end if;

  return public.is_project_editor(p_project_id);
end;
$$;
