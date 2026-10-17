-- Representative pre-Priority-1 production data: a company with two
-- sites, an owner, a collaborator, and a company logo already set —
-- applied against pre_organisations_schema.sql, then the CURRENT
-- sql/schema.sql is layered on top to prove the real migration path
-- (tests/database/run.mjs) preserves every one of these relationships.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'collab1@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'owner2@example.com')
on conflict do nothing;

insert into public.projects (id, name, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Red Dragon', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Tudor Inn', '33333333-3333-3333-3333-333333333333')
on conflict do nothing;

insert into public.project_members (project_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'collaborator'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'owner')
on conflict do nothing;

insert into public.org_settings (id, logo_url) values (1, 'https://example.com/logo.png')
on conflict (id) do nothing;

insert into public.plots (id, project_id, plot_number) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Plot 1')
on conflict do nothing;

insert into public.weekly_reports (id, project_id, week_starting, week_ending) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-01-05', '2026-01-09')
on conflict do nothing;
