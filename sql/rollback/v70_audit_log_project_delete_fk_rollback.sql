-- v70 ROLLBACK. Restores write_audit_log() to its pre-v70 definition —
-- the one that fails with a foreign key error on
-- audit_log_project_id_fkey when deleting any project (empty or not).
--
-- When to use: only if v70 itself turns out to cause a problem. This
-- does not undo any data: v70 only changed a trigger function's logic,
-- it never altered a table, column or row. Running this script simply
-- means project deletion goes back to being broken in the way it was
-- before v70 — every project delete (and, before that, only once this
-- was reached, some child-table deletes during a project's cascade)
-- will again fail with the FK violation. No audit_log rows are deleted
-- or modified by this script, in either direction.
--
-- Safe to run more than once (CREATE OR REPLACE FUNCTION is
-- idempotent); there is no marker/guard needed the way v69's rollback
-- requires one, because this change has no one-off side effects to
-- protect against re-running.

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
    v_project_id := v_record_id;
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
