-- TEST-ONLY shim (never part of sql/schema.sql). v61 retired invite
-- codes: join_project_by_invite()/regenerate_*_invite_code() now refuse.
-- Many pre-v61 security tests used them purely as fixture plumbing to
-- put a SAME-COMPANY colleague onto a project. These test_* functions
-- reproduce exactly that fixture — the joiner becomes a member of the
-- project's owning company (as if approved via a membership request)
-- and is added to the project (as add_org_member_to_project() would) —
-- so those tests keep testing what they always tested. The real,
-- retired functions are covered by tests/security/invites.test.mjs.
-- v68: the retired functions are also closed to signed-in users (EXECUTE
-- revoked from authenticated), so these shims are the ONLY way a test
-- can still put a same-company colleague on a project this way. The
-- shims never call the retired functions themselves.
create or replace function public.test_regenerate_invite_code(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_project_owner(p_project_id) then raise exception 'Only the project owner can do this'; end if;
  update public.projects set invite_code = c where id = p_project_id; return c;
end $$;
create or replace function public.test_regenerate_snagging_invite_code(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_project_owner(p_project_id) then raise exception 'Only the project owner can do this'; end if;
  update public.projects set snagging_invite_code = c where id = p_project_id; return c;
end $$;
create or replace function public.test_join_project_by_invite(invite_code_param text)
returns uuid language plpgsql security definer set search_path = public as $$
declare proj_id uuid; proj_org uuid; r text;
begin
  select id, org_id, 'collaborator' into proj_id, proj_org, r from public.projects where invite_code = invite_code_param;
  if proj_id is null then
    select id, org_id, 'snagging' into proj_id, proj_org, r from public.projects where snagging_invite_code = invite_code_param;
  end if;
  if proj_id is null then return null; end if;
  insert into public.organisation_members (org_id, user_id, role) values (proj_org, auth.uid(), 'member') on conflict (org_id, user_id) do nothing;
  insert into public.project_members (project_id, user_id, role) values (proj_id, auth.uid(), r) on conflict (project_id, user_id) do nothing;
  return proj_id;
end $$;
revoke all on function public.test_regenerate_invite_code(uuid) from public, anon;
revoke all on function public.test_regenerate_snagging_invite_code(uuid) from public, anon;
revoke all on function public.test_join_project_by_invite(text) from public, anon;
grant execute on function public.test_regenerate_invite_code(uuid), public.test_regenerate_snagging_invite_code(uuid), public.test_join_project_by_invite(text) to authenticated;
