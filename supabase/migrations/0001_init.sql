-- JCT Compensation Event Platform — initial schema
-- Standalone platform: separate auth/data from the existing multi-site tracker app.

create extension if not exists "pgcrypto";

-- ── organizations ────────────────────────────────────────────────
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  tier_type  text not null check (tier_type in ('client','main_contractor','subcontractor','employers_agent')),
  created_at timestamptz not null default now()
);

-- ── profiles (one per auth.users row, created by the app on first sign-in) ─
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  email      text not null,
  role       text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);
create index profiles_org_id_idx on profiles(org_id);

-- ── projects ──────────────────────────────────────────────────────
create table projects (
  id            uuid primary key default gen_random_uuid(),
  owner_org_id  uuid not null references organizations(id) on delete cascade,
  name          text not null,
  contract_type text not null default 'jct_db' check (contract_type in ('jct_db','jct_sbc','jct_ic')),
  created_at    timestamptz not null default now()
);
create index projects_owner_org_id_idx on projects(owner_org_id);

-- ── project_memberships ───────────────────────────────────────────
-- Tier is per-membership, not fixed on the org — an org can be MC on one
-- project and Subcontractor on another.
create table project_memberships (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  tier_type   text not null check (tier_type in ('client','main_contractor','subcontractor','employers_agent')),
  status      text not null default 'invited' check (status in ('invited','active','removed')),
  invited_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (project_id, org_id)
);
create index project_memberships_project_id_idx on project_memberships(project_id);
create index project_memberships_org_id_idx on project_memberships(org_id);

-- ── project_invitations ───────────────────────────────────────────
create table project_invitations (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  invited_org_email text not null,
  tier_type         text not null check (tier_type in ('client','main_contractor','subcontractor','employers_agent')),
  token             text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at        timestamptz not null default (now() + interval '14 days'),
  status            text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  invited_by        uuid references profiles(id),
  created_at        timestamptz not null default now()
);
create index project_invitations_project_id_idx on project_invitations(project_id);
create index project_invitations_token_idx on project_invitations(token);

-- ── project_permissions (per-project override of the default visibility table) ─
create table project_permissions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  tier_type    text not null check (tier_type in ('client','main_contractor','subcontractor','employers_agent')),
  data_scope   text not null check (data_scope in ('own_diary','other_diary','flagged_events','draft_notices','dashboards')),
  access_level text not null check (access_level in ('none','summary','own_only','full','read_only','create_edit')),
  updated_at   timestamptz not null default now(),
  unique (project_id, tier_type, data_scope)
);

-- ── diary_entries (lightweight — not shared with the tracker app) ─
create table diary_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  entry_date  date not null default current_date,
  category    text not null check (category in ('progress','instruction','weather','delay','access','comment')),
  free_text   text not null,
  photo_urls  text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index diary_entries_project_id_idx on diary_entries(project_id);
create index diary_entries_org_id_idx on diary_entries(org_id);

-- ── jct_clause_reference (seeded reference data, not org-scoped) ──
create table jct_clause_reference (
  id                         uuid primary key default gen_random_uuid(),
  contract_type              text not null check (contract_type in ('jct_db','jct_sbc','jct_ic')),
  clause_ref                 text not null,
  category                   text not null check (category in ('relevant_event','relevant_matter')),
  title                      text not null,
  trigger_keywords           text[] not null default '{}',
  notice_requirement         text not null,
  notice_window_description  text not null,
  notice_window_days         int
);
create index jct_clause_reference_contract_type_idx on jct_clause_reference(contract_type);

-- ── flagged_events (AI matching output) ────────────────────────────
create table flagged_events (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  entry_id            uuid not null references diary_entries(id) on delete cascade,
  org_id              uuid not null references organizations(id) on delete cascade,
  tier_type           text not null check (tier_type in ('client','main_contractor','subcontractor','employers_agent')),
  clause_ref          text not null,
  category            text not null check (category in ('relevant_event','relevant_matter')),
  confidence          numeric not null check (confidence >= 0 and confidence <= 1),
  extracted_summary   text not null,
  status              text not null default 'new' check (status in ('new','reviewed','notice_drafted','dismissed')),
  days_since_trigger  int not null default 0,
  created_at          timestamptz not null default now(),
  unique (entry_id, clause_ref)
);
create index flagged_events_project_id_idx on flagged_events(project_id);
create index flagged_events_status_idx on flagged_events(status);

-- ── helper functions ────────────────────────────────────────────────

create or replace function user_org_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

-- Active tier of the caller's org on a given project (null if not a member).
create or replace function user_project_tier(p_project_id uuid)
returns text
language sql stable
security definer
set search_path = public
as $$
  select tier_type from project_memberships
  where project_id = p_project_id
    and org_id = user_org_id()
    and status = 'active'
  limit 1;
$$;

create or replace function is_project_member(p_project_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_memberships
    where project_id = p_project_id and org_id = user_org_id() and status = 'active'
  ) or exists (
    select 1 from projects where id = p_project_id and owner_org_id = user_org_id()
  );
$$;

-- ── row level security ─────────────────────────────────────────────

alter table organizations       enable row level security;
alter table profiles            enable row level security;
alter table projects            enable row level security;
alter table project_memberships enable row level security;
alter table project_invitations enable row level security;
alter table project_permissions enable row level security;
alter table diary_entries       enable row level security;
alter table jct_clause_reference enable row level security;
alter table flagged_events      enable row level security;

-- organizations: members can see their own org; project co-members can see
-- the org name/tier of other orgs on a shared project (needed for UI labels).
create policy organizations_select on organizations for select
using (
  id = user_org_id()
  or exists (
    select 1 from project_memberships pm_self
    join project_memberships pm_other on pm_other.project_id = pm_self.project_id
    where pm_self.org_id = user_org_id()
      and pm_self.status = 'active'
      and pm_other.org_id = organizations.id
      and pm_other.status = 'active'
  )
);
create policy organizations_insert on organizations for insert
with check (auth.role() = 'authenticated'); -- org signup happens right after auth.signUp(); no profile exists yet, so this can't be scoped any tighter than "signed in"

-- profiles: see your own org's members only.
create policy profiles_select on profiles for select
using (org_id = user_org_id());
create policy profiles_insert on profiles for insert
with check (id = auth.uid());
create policy profiles_update on profiles for update
using (id = auth.uid());

-- projects: owner org, or any org with an active/invited membership.
create policy projects_select on projects for select
using (
  owner_org_id = user_org_id()
  or exists (
    select 1 from project_memberships
    where project_id = projects.id and org_id = user_org_id()
  )
);
create policy projects_insert on projects for insert
with check (owner_org_id = user_org_id());

-- project_memberships: visible to any active member of the project (so
-- everyone can see who else is on the project), and to invited-but-not-yet-
-- active orgs viewing their own row.
create policy project_memberships_select on project_memberships for select
using (
  org_id = user_org_id()
  or is_project_member(project_id)
);
create policy project_memberships_insert on project_memberships for insert
with check (
  exists (select 1 from projects where id = project_id and owner_org_id = user_org_id())
  or org_id = user_org_id() -- an org accepting its own invite
);
create policy project_memberships_update on project_memberships for update
using (
  exists (select 1 from projects where id = project_id and owner_org_id = user_org_id())
  or org_id = user_org_id()
);

-- project_invitations: visible to the project owner org (who sent it).
-- Acceptance is handled server-side (Netlify function, service role) so an
-- unauthenticated invitee can redeem a token without needing SELECT access.
create policy project_invitations_select on project_invitations for select
using (
  exists (select 1 from projects where id = project_id and owner_org_id = user_org_id())
);
create policy project_invitations_insert on project_invitations for insert
with check (
  exists (select 1 from projects where id = project_id and owner_org_id = user_org_id())
  or user_project_tier(project_id) = 'employers_agent'
);

-- project_permissions: readable by project members, editable by the owner org.
create policy project_permissions_select on project_permissions for select
using (is_project_member(project_id));
create policy project_permissions_write on project_permissions for all
using (exists (select 1 from projects where id = project_id and owner_org_id = user_org_id()))
with check (exists (select 1 from projects where id = project_id and owner_org_id = user_org_id()));

-- diary_entries — default visibility table:
--   own org's entries: always visible to the authoring org
--   Employer's Agent: full visibility across the project (contract admin role)
--   Main Contractor: sees Subcontractor entries (theirs to manage)
--   Client / Subcontractor: own entries only (Client gets summaries via the
--     dashboard, not row-level access to other orgs' diaries)
-- A project_permissions row with data_scope='other_diary' and
-- access_level in ('full','summary') widens this per-project without a redeploy.
create policy diary_entries_select on diary_entries for select
using (
  org_id = user_org_id()
  or exists (
    select 1 from project_memberships pm_self
    join project_memberships pm_target
      on pm_target.project_id = pm_self.project_id
     and pm_target.org_id = diary_entries.org_id
     and pm_target.status = 'active'
    where pm_self.project_id = diary_entries.project_id
      and pm_self.org_id = user_org_id()
      and pm_self.status = 'active'
      and (
        pm_self.tier_type = 'employers_agent'
        or (pm_self.tier_type = 'main_contractor' and pm_target.tier_type = 'subcontractor')
      )
  )
  or exists (
    select 1 from project_permissions pp
    join project_memberships pm on pm.project_id = pp.project_id
      and pm.org_id = user_org_id() and pm.status = 'active' and pm.tier_type = pp.tier_type
    where pp.project_id = diary_entries.project_id
      and pp.data_scope = 'other_diary'
      and pp.access_level in ('full','summary')
  )
);
create policy diary_entries_insert on diary_entries for insert
with check (org_id = user_org_id() and author_id = auth.uid());

-- jct_clause_reference: reference data, readable by any authenticated user.
create policy jct_clause_reference_select on jct_clause_reference for select
using (auth.role() = 'authenticated');

-- flagged_events — default visibility table:
--   Client, Main Contractor, Employer's Agent: all flagged events on the project
--   Subcontractor: own org's flagged events only
create policy flagged_events_select on flagged_events for select
using (
  org_id = user_org_id()
  or exists (
    select 1 from project_memberships
    where project_id = flagged_events.project_id
      and org_id = user_org_id()
      and status = 'active'
      and tier_type in ('client','main_contractor','employers_agent')
  )
);

-- Status updates ("can action"): Main Contractor and Employer's Agent can
-- action any flagged event on the project; every tier can action its own
-- org's (covers a Subcontractor actioning its own). Client stays read-only
-- per the default visibility table and gets no UPDATE policy at all.
create policy flagged_events_update on flagged_events for update
using (
  org_id = user_org_id()
  or exists (
    select 1 from project_memberships
    where project_id = flagged_events.project_id
      and org_id = user_org_id()
      and status = 'active'
      and tier_type in ('main_contractor','employers_agent')
  )
);
