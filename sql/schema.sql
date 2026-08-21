-- Site Tracker schema
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: uses "if not exists" / "on conflict do nothing" throughout.

create extension if not exists "pgcrypto";

-- ─── PROJECTS (sites) ─────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  contract_ref text,
  main_contractor_name text,
  main_contractor_email text,
  start_date date,
  status text not null default 'active' check (status in ('active', 'complete', 'on hold')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ─── WEEKLY REPORTS ───────────────────────────────────────────────
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  week_starting date not null,
  week_ending date not null,
  prepared_by text,
  weather text,
  labour_on_site text,
  progress_summary text,
  programme_status text not null default 'on-track' check (programme_status in ('ahead', 'on-track', 'behind')),
  health_safety_notes text,
  deliveries_materials text,
  issues_risks text,
  next_week_plan text,
  photos jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ─── SNAG ITEMS ───────────────────────────────────────────────────
create table if not exists public.snag_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_no integer,
  location text,
  description text not null,
  trade text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'closed')),
  photo_url text,
  raised_date date not null default current_date,
  closed_date date,
  raised_by text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Auto-number snag items per project (1, 2, 3... within each site)
create or replace function public.set_snag_item_no()
returns trigger as $$
begin
  if new.item_no is null then
    select coalesce(max(item_no), 0) + 1 into new.item_no
    from public.snag_items
    where project_id = new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_snag_item_no on public.snag_items;
create trigger trg_snag_item_no
before insert on public.snag_items
for each row execute function public.set_snag_item_no();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────
-- Any signed-in user of your Supabase project can read/write everything.
-- This app is meant for a small internal team (the client-side staff), not
-- the public, so a single shared workspace with no per-row ownership is
-- the simplest model. Only create logins for people on your team.

alter table public.projects enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.snag_items enable row level security;

drop policy if exists "authenticated read projects" on public.projects;
create policy "authenticated read projects" on public.projects for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert projects" on public.projects;
create policy "authenticated insert projects" on public.projects for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update projects" on public.projects;
create policy "authenticated update projects" on public.projects for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete projects" on public.projects;
create policy "authenticated delete projects" on public.projects for delete using (auth.role() = 'authenticated');

drop policy if exists "authenticated read weekly_reports" on public.weekly_reports;
create policy "authenticated read weekly_reports" on public.weekly_reports for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert weekly_reports" on public.weekly_reports;
create policy "authenticated insert weekly_reports" on public.weekly_reports for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update weekly_reports" on public.weekly_reports;
create policy "authenticated update weekly_reports" on public.weekly_reports for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete weekly_reports" on public.weekly_reports;
create policy "authenticated delete weekly_reports" on public.weekly_reports for delete using (auth.role() = 'authenticated');

drop policy if exists "authenticated read snag_items" on public.snag_items;
create policy "authenticated read snag_items" on public.snag_items for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert snag_items" on public.snag_items;
create policy "authenticated insert snag_items" on public.snag_items for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update snag_items" on public.snag_items;
create policy "authenticated update snag_items" on public.snag_items for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete snag_items" on public.snag_items;
create policy "authenticated delete snag_items" on public.snag_items for delete using (auth.role() = 'authenticated');

-- ─── STORAGE (photos for reports & snags) ────────────────────────
insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read site-photos" on storage.objects;
create policy "public read site-photos" on storage.objects
  for select using (bucket_id = 'site-photos');

drop policy if exists "authenticated upload site-photos" on storage.objects;
create policy "authenticated upload site-photos" on storage.objects
  for insert with check (bucket_id = 'site-photos' and auth.role() = 'authenticated');

drop policy if exists "authenticated delete site-photos" on storage.objects;
create policy "authenticated delete site-photos" on storage.objects
  for delete using (bucket_id = 'site-photos' and auth.role() = 'authenticated');

-- ─── v2 ADDITIONS ─────────────────────────────────────────────────
-- Everything below is additive and safe to run against a database that
-- already has the tables above. Re-run this whole file any time it changes.

-- Company logo (single row, shown on every printed report/snag sheet)
create table if not exists public.org_settings (
  id smallint primary key default 1 check (id = 1),
  logo_url text,
  updated_at timestamptz not null default now()
);

alter table public.org_settings enable row level security;
drop policy if exists "authenticated read org_settings" on public.org_settings;
create policy "authenticated read org_settings" on public.org_settings for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert org_settings" on public.org_settings;
create policy "authenticated insert org_settings" on public.org_settings for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update org_settings" on public.org_settings;
create policy "authenticated update org_settings" on public.org_settings for update using (auth.role() = 'authenticated');

-- Weekly reports: itemised progress / next-week lists.
-- (Old progress_summary / next_week_plan / labour_on_site columns are left
-- in place, unused, so no existing data is lost.)
alter table public.weekly_reports add column if not exists progress_items jsonb not null default '[]'::jsonb;
alter table public.weekly_reports add column if not exists next_week_items jsonb not null default '[]'::jsonb;

-- Snagging is now organised into named snag lists per site, each with its
-- own set of items, instead of one continuous list per project.
create table if not exists public.snag_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.snag_lists enable row level security;
drop policy if exists "authenticated read snag_lists" on public.snag_lists;
create policy "authenticated read snag_lists" on public.snag_lists for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert snag_lists" on public.snag_lists;
create policy "authenticated insert snag_lists" on public.snag_lists for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update snag_lists" on public.snag_lists;
create policy "authenticated update snag_lists" on public.snag_lists for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete snag_lists" on public.snag_lists;
create policy "authenticated delete snag_lists" on public.snag_lists for delete using (auth.role() = 'authenticated');

alter table public.snag_items add column if not exists snag_list_id uuid references public.snag_lists(id) on delete cascade;

-- Item numbers now restart at 1 within each snag list rather than per project.
create or replace function public.set_snag_item_no()
returns trigger as $$
begin
  if new.item_no is null then
    select coalesce(max(item_no), 0) + 1 into new.item_no
    from public.snag_items
    where snag_list_id = new.snag_list_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- ─── v3 ADDITIONS ─────────────────────────────────────────────────
-- Client-side construction management: RAG/progress tracking, quality
-- gates, a commercial early-warning/variation log, and a statutory
-- handover document checklist. Additive and safe to re-run.

-- Dashboard RAG status + baseline vs actual progress
alter table public.projects add column if not exists rag_status text not null default 'amber' check (rag_status in ('red', 'amber', 'green'));
alter table public.projects add column if not exists baseline_progress_pct numeric not null default 0 check (baseline_progress_pct >= 0 and baseline_progress_pct <= 100);
alter table public.projects add column if not exists actual_progress_pct numeric not null default 0 check (actual_progress_pct >= 0 and actual_progress_pct <= 100);

-- Quality Gates: 4 standard hold-points per site, each with a checklist.
-- checklist is a jsonb array of {text, checked, checked_at}.
create table if not exists public.quality_gates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  gate_key text not null,
  title text not null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'under_review', 'approved')),
  checklist jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, gate_key)
);

alter table public.quality_gates enable row level security;
drop policy if exists "authenticated read quality_gates" on public.quality_gates;
create policy "authenticated read quality_gates" on public.quality_gates for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert quality_gates" on public.quality_gates;
create policy "authenticated insert quality_gates" on public.quality_gates for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update quality_gates" on public.quality_gates;
create policy "authenticated update quality_gates" on public.quality_gates for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete quality_gates" on public.quality_gates;
create policy "authenticated delete quality_gates" on public.quality_gates for delete using (auth.role() = 'authenticated');

-- Commercial log: early warnings & proposed variations.
-- cost_impact / time_impact_days left null to mean "TBC" / "Nil".
create table if not exists public.commercial_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  type text not null check (type in ('early_warning', 'proposed_variation')),
  cost_impact numeric,
  time_impact_days integer,
  status text not null default 'pending_client_review' check (status in ('pending_client_review', 'approved', 'rejected')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.commercial_items enable row level security;
drop policy if exists "authenticated read commercial_items" on public.commercial_items;
create policy "authenticated read commercial_items" on public.commercial_items for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert commercial_items" on public.commercial_items;
create policy "authenticated insert commercial_items" on public.commercial_items for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update commercial_items" on public.commercial_items;
create policy "authenticated update commercial_items" on public.commercial_items for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete commercial_items" on public.commercial_items;
create policy "authenticated delete commercial_items" on public.commercial_items for delete using (auth.role() = 'authenticated');

-- Handover checklist: 5 standard statutory documents per site.
create table if not exists public.handover_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  doc_key text not null,
  title text not null,
  status text not null default 'missing' check (status in ('missing', 'draft_received', 'approved_final')),
  file_url text,
  file_name text,
  updated_at timestamptz not null default now(),
  unique (project_id, doc_key)
);

alter table public.handover_documents enable row level security;
drop policy if exists "authenticated read handover_documents" on public.handover_documents;
create policy "authenticated read handover_documents" on public.handover_documents for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert handover_documents" on public.handover_documents;
create policy "authenticated insert handover_documents" on public.handover_documents for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update handover_documents" on public.handover_documents;
create policy "authenticated update handover_documents" on public.handover_documents for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete handover_documents" on public.handover_documents;
create policy "authenticated delete handover_documents" on public.handover_documents for delete using (auth.role() = 'authenticated');

-- Auto-create the 4 quality gates + 5 handover documents whenever a new
-- site is created, pre-filled with standard checklist items.
create or replace function public.seed_project_defaults()
returns trigger as $$
begin
  insert into public.quality_gates (project_id, gate_key, title, sort_order, checklist) values
    (new.id, 'substructure_drainage', 'Substructure & Drainage', 1, '[
       {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
       {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
       {"text": "DPC level verified", "checked": false, "checked_at": null},
       {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.id, 'frame_watertight', 'Frame & Wind/Watertight', 2, '[
       {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
       {"text": "Cavity barriers inspected", "checked": false, "checked_at": null},
       {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
       {"text": "Roof confirmed watertight", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.id, 'pre_plaster_first_fix', 'Pre-Plaster / First Fix', 3, '[
       {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
       {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
       {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
       {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.id, 'pre_handover_pc', 'Pre-Handover / PC', 4, '[
       {"text": "Snagging list closed out", "checked": false, "checked_at": null},
       {"text": "O&M manuals received", "checked": false, "checked_at": null},
       {"text": "All statutory certificates received", "checked": false, "checked_at": null},
       {"text": "Final client walkthrough completed", "checked": false, "checked_at": null}
     ]'::jsonb)
  on conflict (project_id, gate_key) do nothing;

  insert into public.handover_documents (project_id, doc_key, title) values
    (new.id, 'building_control', 'Building Control Sign-off (Initial/Final)'),
    (new.id, 'air_acoustic_test', 'Air Permeability / Acoustic Test Certificates'),
    (new.id, 'elec_gas_certs', 'Electrical & Gas Safety Certificates'),
    (new.id, 'warranty_cover_note', 'NHBC/Structural Warranty Cover Note'),
    (new.id, 'om_manuals', 'Draft O&M Manuals')
  on conflict (project_id, doc_key) do nothing;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_seed_project_defaults on public.projects;
create trigger trg_seed_project_defaults
after insert on public.projects
for each row execute function public.seed_project_defaults();

-- Backfill quality gates + handover documents for sites that already
-- existed before this migration (e.g. any site you created while testing).
-- Guarded to only run before the v5 migration below has ever been applied
-- (i.e. while quality_gates.plot_id doesn't exist yet) — once v5 has run,
-- this step is obsolete: v5's own backfill takes over, and re-running this
-- unconditionally would break for any site with no plots yet (plot_id is
-- required from v5 onwards) and would target a unique constraint that v5
-- has since replaced. Safe to leave in place permanently as a no-op after
-- the first time v5 runs.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quality_gates' and column_name = 'plot_id'
  ) then
    insert into public.quality_gates (project_id, gate_key, title, sort_order, checklist)
    select p.id, g.gate_key, g.title, g.sort_order, g.checklist
    from public.projects p
    cross join (values
      ('substructure_drainage', 'Substructure & Drainage', 1, '[
         {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
         {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
         {"text": "DPC level verified", "checked": false, "checked_at": null},
         {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
       ]'::jsonb),
      ('frame_watertight', 'Frame & Wind/Watertight', 2, '[
         {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
         {"text": "Cavity barriers inspected", "checked": false, "checked_at": null},
         {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
         {"text": "Roof confirmed watertight", "checked": false, "checked_at": null}
       ]'::jsonb),
      ('pre_plaster_first_fix', 'Pre-Plaster / First Fix', 3, '[
         {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
         {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
         {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
         {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
       ]'::jsonb),
      ('pre_handover_pc', 'Pre-Handover / PC', 4, '[
         {"text": "Snagging list closed out", "checked": false, "checked_at": null},
         {"text": "O&M manuals received", "checked": false, "checked_at": null},
         {"text": "All statutory certificates received", "checked": false, "checked_at": null},
         {"text": "Final client walkthrough completed", "checked": false, "checked_at": null}
       ]'::jsonb)
    ) as g(gate_key, title, sort_order, checklist)
    on conflict (project_id, gate_key) do nothing;

    insert into public.handover_documents (project_id, doc_key, title)
    select p.id, d.doc_key, d.title
    from public.projects p
    cross join (values
      ('building_control', 'Building Control Sign-off (Initial/Final)'),
      ('air_acoustic_test', 'Air Permeability / Acoustic Test Certificates'),
      ('elec_gas_certs', 'Electrical & Gas Safety Certificates'),
      ('warranty_cover_note', 'NHBC/Structural Warranty Cover Note'),
      ('om_manuals', 'Draft O&M Manuals')
    ) as d(doc_key, title)
    on conflict (project_id, doc_key) do nothing;
  end if;
end $$;

-- ─── v4 ADDITIONS ─────────────────────────────────────────────────
-- Pinpoint Snagging & QA: an overall site layout drawing plus per-plot
-- floor plan drawings, with percentage-based pin coordinates on snags
-- and quality gates so pins scale correctly on any screen size.

-- Overall site master plan (one per site) lives directly on projects;
-- individual plot/floor drawings live in the new drawings table below.
alter table public.projects add column if not exists site_layout_url text;

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

-- Pin coordinates on snag items — percentage of drawing width/height
-- (0-100), nullable so ordinary text-only snags still work with no pin.
alter table public.snag_items add column if not exists drawing_id uuid references public.drawings(id) on delete set null;
alter table public.snag_items add column if not exists x_coordinate numeric check (x_coordinate >= 0 and x_coordinate <= 100);
alter table public.snag_items add column if not exists y_coordinate numeric check (y_coordinate >= 0 and y_coordinate <= 100);

-- Pin coordinates on quality gates — one pin per gate, marking the
-- area/zone that hold-point covers on a drawing.
alter table public.quality_gates add column if not exists drawing_id uuid references public.drawings(id) on delete set null;
alter table public.quality_gates add column if not exists x_coordinate numeric check (x_coordinate >= 0 and x_coordinate <= 100);
alter table public.quality_gates add column if not exists y_coordinate numeric check (y_coordinate >= 0 and y_coordinate <= 100);

-- ─── v5 ADDITIONS ─────────────────────────────────────────────────
-- Quality Gates and the Handover Checklist are now tracked per plot
-- ("Plot Handovers") instead of once for the whole site, since each
-- house/unit goes through its own sign-off. Any earlier site-level
-- data is migrated into a default "Plot 1" so nothing is lost.

create table if not exists public.plots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_number text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.plots enable row level security;
drop policy if exists "authenticated read plots" on public.plots;
create policy "authenticated read plots" on public.plots for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert plots" on public.plots;
create policy "authenticated insert plots" on public.plots for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update plots" on public.plots;
create policy "authenticated update plots" on public.plots for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete plots" on public.plots;
create policy "authenticated delete plots" on public.plots for delete using (auth.role() = 'authenticated');

alter table public.quality_gates add column if not exists plot_id uuid references public.plots(id) on delete cascade;
alter table public.handover_documents add column if not exists plot_id uuid references public.plots(id) on delete cascade;

-- Backfill: any project with pre-existing (plot_id null) gates/handover
-- docs from before plots existed gets a default "Plot 1" to own them.
-- (v15, much later, reopens plot_id to nullable for block-scoped
-- gates/documents — those are a different, intentional kind of "plot_id
-- null" row, never legacy orphans, so this only ever touches a row that
-- is ALSO block_id null once that column exists. On a truly fresh
-- database block_id doesn't exist yet at this point in the script, so
-- the plain plot_id-only check below is used — safe, since no
-- block-scoped rows can possibly exist yet either.)
do $$
declare
  proj record;
  new_plot_id uuid;
  has_block_id boolean;
  block_filter text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quality_gates' and column_name = 'block_id'
  ) into has_block_id;
  -- block_id doesn't exist as a column until this file's v15 additions
  -- run, further down — can't reference it in a static query before
  -- that, even behind a runtime boolean, since the query planner needs
  -- the column to exist. Build the filter dynamically instead.
  block_filter := case when has_block_id then 'and block_id is null' else '' end;

  for proj in execute format(
    'select distinct project_id from public.quality_gates where plot_id is null %1$s
     union
     select distinct project_id from public.handover_documents where plot_id is null %1$s',
    block_filter
  )
  loop
    insert into public.plots (project_id, plot_number)
    values (proj.project_id, 'Plot 1')
    returning id into new_plot_id;

    execute format('update public.quality_gates set plot_id = $1 where project_id = $2 and plot_id is null %s', block_filter)
      using new_plot_id, proj.project_id;
    execute format('update public.handover_documents set plot_id = $1 where project_id = $2 and plot_id is null %s', block_filter)
      using new_plot_id, proj.project_id;
  end loop;
end $$;

-- (v5 originally enforced plot_id not null here, once every legacy row
-- had been backfilled onto a plot above. v15 later reopens plot_id to
-- nullable — a block-scoped gate/document has no plot_id at all — so
-- that enforcement no longer belongs here; seeing it removed on a diff
-- is expected, not a regression.)

-- Uniqueness of a gate/doc is now per plot, not per project.
alter table public.quality_gates drop constraint if exists quality_gates_project_id_gate_key_key;
alter table public.quality_gates drop constraint if exists quality_gates_plot_id_gate_key_key;
alter table public.quality_gates add constraint quality_gates_plot_id_gate_key_key unique (plot_id, gate_key);

alter table public.handover_documents drop constraint if exists handover_documents_project_id_doc_key_key;
alter table public.handover_documents drop constraint if exists handover_documents_plot_id_doc_key_key;
alter table public.handover_documents add constraint handover_documents_plot_id_doc_key_key unique (plot_id, doc_key);

-- Seed a new plot's 4 gates + 5 handover documents automatically.
create or replace function public.seed_plot_defaults()
returns trigger as $$
begin
  insert into public.quality_gates (project_id, plot_id, gate_key, title, sort_order, checklist) values
    (new.project_id, new.id, 'substructure_drainage', 'Substructure & Drainage', 1, '[
       {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
       {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
       {"text": "DPC level verified", "checked": false, "checked_at": null},
       {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'frame_watertight', 'Frame & Wind/Watertight', 2, '[
       {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
       {"text": "Cavity barriers inspected", "checked": false, "checked_at": null},
       {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
       {"text": "Roof confirmed watertight", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'pre_plaster_first_fix', 'Pre-Plaster / First Fix', 3, '[
       {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
       {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
       {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
       {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'pre_handover_pc', 'Pre-Handover / PC', 4, '[
       {"text": "Snagging list closed out", "checked": false, "checked_at": null},
       {"text": "O&M manuals received", "checked": false, "checked_at": null},
       {"text": "All statutory certificates received", "checked": false, "checked_at": null},
       {"text": "Final client walkthrough completed", "checked": false, "checked_at": null}
     ]'::jsonb)
  on conflict (plot_id, gate_key) do nothing;

  insert into public.handover_documents (project_id, plot_id, doc_key, title) values
    (new.project_id, new.id, 'building_control', 'Building Control Sign-off (Initial/Final)'),
    (new.project_id, new.id, 'air_acoustic_test', 'Air Permeability / Acoustic Test Certificates'),
    (new.project_id, new.id, 'elec_gas_certs', 'Electrical & Gas Safety Certificates'),
    (new.project_id, new.id, 'warranty_cover_note', 'NHBC/Structural Warranty Cover Note'),
    (new.project_id, new.id, 'om_manuals', 'Draft O&M Manuals')
  on conflict (plot_id, doc_key) do nothing;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_seed_plot_defaults on public.plots;
create trigger trg_seed_plot_defaults
after insert on public.plots
for each row execute function public.seed_plot_defaults();

-- Sites no longer get gates/handover docs seeded directly — only plots do.
drop trigger if exists trg_seed_project_defaults on public.projects;

-- ─── v6 ADDITIONS ─────────────────────────────────────────────────
-- Weekly reports: "Deliveries / Materials" replaced with a general
-- "Other Comments" field. The old column is left in place, unused, so
-- no existing data is lost.
alter table public.weekly_reports add column if not exists other_comments text;

-- ─── v7 ADDITIONS ─────────────────────────────────────────────────
-- Formal client Instructions alongside Early Warnings / Proposed
-- Variations, and a "Commercial Items This Week" section on the
-- weekly report that pushes new entries straight into the ledger.

alter table public.commercial_items drop constraint if exists commercial_items_type_check;
alter table public.commercial_items add constraint commercial_items_type_check
  check (type in ('early_warning', 'proposed_variation', 'instruction'));

-- Traceability: which weekly report (if any) a ledger entry was raised in.
-- Kept even if the report is later deleted — the ledger entry is the
-- durable commercial record, independent of the report once it exists.
alter table public.commercial_items add column if not exists weekly_report_id uuid references public.weekly_reports(id) on delete set null;

-- The report's own printable snapshot of commercial items noted that
-- week. Each item is { id, title, type, cost_impact, time_impact_days,
-- ledger_id } — ledger_id is set once the item has been pushed to
-- commercial_items, so re-saving the report never creates duplicates.
alter table public.weekly_reports add column if not exists commercial_items jsonb not null default '[]'::jsonb;

-- ─── v8 ADDITIONS ─────────────────────────────────────────────────
-- Snagging is now organised per plot (the same `plots` table used by
-- Plot Handovers) instead of freely-named lists — each plot gets exactly
-- one snag list, auto-created alongside its quality gates and handover
-- documents. Priority and "raised by" are no longer collected in the
-- app; the columns stay in place (unused) so no existing data is lost.

alter table public.snag_lists add column if not exists plot_id uuid references public.plots(id) on delete cascade;

-- Nulls don't conflict with each other in a unique index, so this still
-- allows any pre-existing (plot_id null) lists to coexist untouched.
create unique index if not exists snag_lists_plot_id_uidx on public.snag_lists (plot_id);

-- Seed a new plot's snag list alongside its quality gates + handover docs.
create or replace function public.seed_plot_defaults()
returns trigger as $$
begin
  insert into public.quality_gates (project_id, plot_id, gate_key, title, sort_order, checklist) values
    (new.project_id, new.id, 'substructure_drainage', 'Substructure & Drainage', 1, '[
       {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
       {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
       {"text": "DPC level verified", "checked": false, "checked_at": null},
       {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'frame_watertight', 'Frame & Wind/Watertight', 2, '[
       {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
       {"text": "Cavity barriers inspected", "checked": false, "checked_at": null},
       {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
       {"text": "Roof confirmed watertight", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'pre_plaster_first_fix', 'Pre-Plaster / First Fix', 3, '[
       {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
       {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
       {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
       {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'pre_handover_pc', 'Pre-Handover / PC', 4, '[
       {"text": "Snagging list closed out", "checked": false, "checked_at": null},
       {"text": "O&M manuals received", "checked": false, "checked_at": null},
       {"text": "All statutory certificates received", "checked": false, "checked_at": null},
       {"text": "Final client walkthrough completed", "checked": false, "checked_at": null}
     ]'::jsonb)
  on conflict (plot_id, gate_key) do nothing;

  insert into public.handover_documents (project_id, plot_id, doc_key, title) values
    (new.project_id, new.id, 'building_control', 'Building Control Sign-off (Initial/Final)'),
    (new.project_id, new.id, 'air_acoustic_test', 'Air Permeability / Acoustic Test Certificates'),
    (new.project_id, new.id, 'elec_gas_certs', 'Electrical & Gas Safety Certificates'),
    (new.project_id, new.id, 'warranty_cover_note', 'NHBC/Structural Warranty Cover Note'),
    (new.project_id, new.id, 'om_manuals', 'Draft O&M Manuals')
  on conflict (plot_id, doc_key) do nothing;

  insert into public.snag_lists (project_id, plot_id, title)
  values (new.project_id, new.id, new.plot_number)
  on conflict (plot_id) do nothing;

  return new;
end;
$$ language plpgsql;

-- Any plot created before this migration existed doesn't have a snag
-- list yet — give it one now.
insert into public.snag_lists (project_id, plot_id, title)
select p.project_id, p.id, p.plot_number
from public.plots p
where not exists (select 1 from public.snag_lists sl where sl.plot_id = p.id);

-- Backfill: any project with a pre-existing (snag_list_id null) snag item
-- from before plots/snag-per-plot existed gets a default "Plot 1" to own
-- it, same pattern used for quality gates/handover docs in v5.
do $$
declare
  proj record;
  target_plot_id uuid;
  target_list_id uuid;
begin
  for proj in
    select distinct project_id from public.snag_items where snag_list_id is null
  loop
    select id into target_plot_id from public.plots where project_id = proj.project_id and plot_number = 'Plot 1' limit 1;
    if target_plot_id is null then
      insert into public.plots (project_id, plot_number) values (proj.project_id, 'Plot 1') returning id into target_plot_id;
    end if;

    select id into target_list_id from public.snag_lists where plot_id = target_plot_id limit 1;
    if target_list_id is null then
      insert into public.snag_lists (project_id, plot_id, title) values (proj.project_id, target_plot_id, 'Plot 1') returning id into target_list_id;
    end if;

    update public.snag_items set snag_list_id = target_list_id where project_id = proj.project_id and snag_list_id is null;
  end loop;
end $$;

-- ─── v9 ADDITIONS ─────────────────────────────────────────────────
-- Monthly reports: a saved snapshot rolling up a calendar month's worth
-- of weekly reports into one document, generated on demand from the
-- Monthly Reports page rather than computed fresh on every view. All the
-- rollup content (progress, H&S, issues, commercial items, snag/plot
-- handover snapshots, photos) is computed client-side at generation time
-- and stored here, so viewing/printing/emailing a past monthly report
-- never changes even if the underlying weekly reports are later edited.

create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  month date not null, -- first day of the calendar month this report covers
  weekly_report_ids uuid[] not null default '{}',
  rag_status text,
  baseline_progress_pct numeric,
  actual_progress_pct numeric,
  -- [{ id, plot, milestone, text, percent, completed_this_month }], deduped
  -- across the month's weekly reports by item id, taking the max percent
  -- reached and the most recent plot/milestone/text seen for that id.
  progress_items jsonb not null default '[]'::jsonb,
  -- [{ week_starting, week_ending, weather, health_safety_notes }]
  health_safety_notes jsonb not null default '[]'::jsonb,
  -- [{ week_starting, week_ending, issues_risks }]
  issues_risks jsonb not null default '[]'::jsonb,
  -- flattened commercial items raised across the month's reports, each
  -- tagged with the week it came from: [{ week_starting, title, type,
  -- cost_impact, time_impact_days, ledger_id }]
  commercial_items jsonb not null default '[]'::jsonb,
  outstanding_items jsonb not null default '[]'::jsonb, -- last report's next_week_items, as-is
  snags_raised_count integer not null default 0,
  snags_closed_count integer not null default 0,
  -- plot handover snapshot as of generation time: [{ plot_number,
  -- gates_approved, gates_total, docs_ready, docs_total }]
  plot_handovers jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, month)
);

alter table public.monthly_reports enable row level security;
drop policy if exists "authenticated read monthly_reports" on public.monthly_reports;
create policy "authenticated read monthly_reports" on public.monthly_reports for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert monthly_reports" on public.monthly_reports;
create policy "authenticated insert monthly_reports" on public.monthly_reports for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated delete monthly_reports" on public.monthly_reports;
create policy "authenticated delete monthly_reports" on public.monthly_reports for delete using (auth.role() = 'authenticated');

-- ─── v10 ADDITIONS ────────────────────────────────────────────────
-- Weather tracker: a day-by-day weather + lost-time log per weekly
-- report. The old single freetext "weather" column is kept (now shown
-- as "Weather Notes") for any commentary that doesn't belong to one
-- specific day — no existing data is lost.

-- [{ date, condition, lost_hours, notes }] — one entry per day of the
-- report's week, generated client-side from week_starting.
alter table public.weekly_reports add column if not exists weather_days jsonb not null default '[]'::jsonb;

-- Monthly rollup: per-week lost-time subtotals, a flattened list of just
-- the days where time was actually lost that month, and a month total.
alter table public.monthly_reports add column if not exists weather_summary jsonb not null default '[]'::jsonb;
alter table public.monthly_reports add column if not exists weather_lost_days jsonb not null default '[]'::jsonb;
alter table public.monthly_reports add column if not exists total_lost_hours numeric not null default 0;

-- ─── v11 ADDITIONS ────────────────────────────────────────────────
-- Weather auto-fill: a site's postcode is geocoded (via postcodes.io,
-- a free UK postcode lookup) into lat/long once and cached here, so the
-- weekly report's weather tracker can look up real weather (via
-- Open-Meteo) for that site without re-geocoding on every report.
alter table public.projects add column if not exists postcode text;
alter table public.projects add column if not exists latitude numeric;
alter table public.projects add column if not exists longitude numeric;

-- ─── v12 ADDITIONS ────────────────────────────────────────────────
-- Automatic progress: "Actual Progress %" is now computed from logged
-- milestone progress rather than typed in by hand. total_plots is the
-- denominator — set once per site — so the same milestone completion
-- moves the needle more on a 4-plot site than a 40-plot one.
alter table public.projects add column if not exists total_plots integer;
alter table public.projects drop constraint if exists projects_total_plots_check;
alter table public.projects add constraint projects_total_plots_check check (total_plots is null or total_plots > 0);

-- ─── v13 ADDITIONS ────────────────────────────────────────────────
-- Automatic progress, take two: milestone-only auto-calc gave no way to
-- correct it when a milestone was missed in a weekly report. Actual
-- Progress is now the average of every plot's own progress % (set
-- directly, or filled from a "Suggest from Milestones" button you have
-- to explicitly click — it never overwrites a number you've typed)
-- plus a single site-wide External / Engineering Works %, for civils
-- work that isn't any one plot. total_plots is left in place, unused —
-- the real plot count is now just however many rows exist in `plots`.
alter table public.plots add column if not exists progress_pct numeric not null default 0;
alter table public.plots drop constraint if exists plots_progress_pct_check;
alter table public.plots add constraint plots_progress_pct_check check (progress_pct >= 0 and progress_pct <= 100);

alter table public.projects add column if not exists external_works_pct numeric not null default 0;
alter table public.projects drop constraint if exists projects_external_works_pct_check;
alter table public.projects add constraint projects_external_works_pct_check check (external_works_pct >= 0 and external_works_pct <= 100);

-- ─── v14 ADDITIONS ────────────────────────────────────────────────
-- Quality gates: some plots (e.g. flats within a block) don't need
-- every gate a house does — add a Not Applicable status alongside the
-- existing ones. N/A gates are excluded from "approved" ratio stats
-- entirely (both sides of the fraction), not counted as a failure.
alter table public.quality_gates drop constraint if exists quality_gates_status_check;
alter table public.quality_gates add constraint quality_gates_status_check
  check (status in ('not_started', 'in_progress', 'under_review', 'approved', 'not_applicable'));

-- ─── v15 ADDITIONS ────────────────────────────────────────────────
-- Apartment blocks: a Block groups several flats under shared
-- structural gates/documents (foundations, frame, roof, communal
-- areas) tracked ONCE, instead of duplicated on every flat. Houses
-- keep working exactly as before — a plot with no block_id.

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  block_name text not null,
  progress_pct numeric not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.blocks enable row level security;
drop policy if exists "authenticated read blocks" on public.blocks;
create policy "authenticated read blocks" on public.blocks for select using (auth.role() = 'authenticated');
drop policy if exists "authenticated insert blocks" on public.blocks;
create policy "authenticated insert blocks" on public.blocks for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update blocks" on public.blocks;
create policy "authenticated update blocks" on public.blocks for update using (auth.role() = 'authenticated');
drop policy if exists "authenticated delete blocks" on public.blocks;
create policy "authenticated delete blocks" on public.blocks for delete using (auth.role() = 'authenticated');

-- A flat is a plot that belongs to a block; a standalone house is a
-- plot with block_id null.
alter table public.plots add column if not exists block_id uuid references public.blocks(id) on delete cascade;

-- quality_gates and handover_documents can now be scoped to either a
-- plot (house or flat) or a block (shared structure) — exactly one.
alter table public.quality_gates alter column plot_id drop not null;
alter table public.quality_gates add column if not exists block_id uuid references public.blocks(id) on delete cascade;
alter table public.quality_gates drop constraint if exists quality_gates_scope_check;
alter table public.quality_gates add constraint quality_gates_scope_check
  check ((plot_id is not null and block_id is null) or (plot_id is null and block_id is not null));
alter table public.quality_gates drop constraint if exists quality_gates_block_id_gate_key_key;
alter table public.quality_gates add constraint quality_gates_block_id_gate_key_key unique (block_id, gate_key);

alter table public.handover_documents alter column plot_id drop not null;
alter table public.handover_documents add column if not exists block_id uuid references public.blocks(id) on delete cascade;
alter table public.handover_documents drop constraint if exists handover_documents_scope_check;
alter table public.handover_documents add constraint handover_documents_scope_check
  check ((plot_id is not null and block_id is null) or (plot_id is null and block_id is not null));
alter table public.handover_documents drop constraint if exists handover_documents_block_id_doc_key_key;
alter table public.handover_documents add constraint handover_documents_block_id_doc_key_key unique (block_id, doc_key);

-- Seed a new block's shared structural gates + statutory documents.
create or replace function public.seed_block_defaults()
returns trigger as $$
begin
  insert into public.quality_gates (project_id, block_id, gate_key, title, sort_order, checklist) values
    (new.project_id, new.id, 'block_substructure_drainage', 'Substructure & Drainage (Block)', 1, '[
       {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
       {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
       {"text": "DPC level verified across the block", "checked": false, "checked_at": null},
       {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'block_frame_superstructure', 'Frame & Superstructure (Block)', 2, '[
       {"text": "Structural frame inspected at each floor", "checked": false, "checked_at": null},
       {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
       {"text": "Fire-stopping / compartmentation between floors installed", "checked": false, "checked_at": null},
       {"text": "Superstructure Building Control inspection passed", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'block_envelope_watertight', 'Roof & Building Envelope (Wind/Watertight)', 3, '[
       {"text": "Roof covering complete and inspected", "checked": false, "checked_at": null},
       {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
       {"text": "Cladding / render system signed off", "checked": false, "checked_at": null},
       {"text": "Building confirmed wind and watertight", "checked": false, "checked_at": null}
     ]'::jsonb),
    (new.project_id, new.id, 'block_communal_fire', 'Communal Areas, M&E & Fire Strategy', 4, '[
       {"text": "Lift(s) commissioned and certified", "checked": false, "checked_at": null},
       {"text": "Communal M&E systems (AOV, sprinklers, fire alarm) commissioned", "checked": false, "checked_at": null},
       {"text": "Fire strategy walk-through completed with Building Control / Fire Officer", "checked": false, "checked_at": null},
       {"text": "Communal areas snagging closed out", "checked": false, "checked_at": null}
     ]'::jsonb)
  on conflict (block_id, gate_key) do nothing;

  insert into public.handover_documents (project_id, block_id, doc_key, title) values
    (new.project_id, new.id, 'block_building_control', 'Building Control Sign-off (Block)'),
    (new.project_id, new.id, 'block_warranty', 'NHBC/Structural Warranty Cover Note (Block)'),
    (new.project_id, new.id, 'block_fire_strategy', 'Fire Strategy & Compartmentation Report'),
    (new.project_id, new.id, 'block_communal_me', 'Communal M&E Handover Pack (Lifts, AOV, Sprinklers)'),
    (new.project_id, new.id, 'block_insurance', 'Building Insurance / Buildings Warranty')
  on conflict (block_id, doc_key) do nothing;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_seed_block_defaults on public.blocks;
create trigger trg_seed_block_defaults
after insert on public.blocks
for each row execute function public.seed_block_defaults();

-- Seed a new plot's gates/documents/snag list — a reduced,
-- flat-appropriate set if it belongs to a block (structural items are
-- the block's job, not this flat's), otherwise the full house set as
-- before.
create or replace function public.seed_plot_defaults()
returns trigger as $$
begin
  if new.block_id is null then
    insert into public.quality_gates (project_id, plot_id, gate_key, title, sort_order, checklist) values
      (new.project_id, new.id, 'substructure_drainage', 'Substructure & Drainage', 1, '[
         {"text": "Foundation excavation inspected by Building Control", "checked": false, "checked_at": null},
         {"text": "Drainage test (air/water) passed and recorded", "checked": false, "checked_at": null},
         {"text": "DPC level verified", "checked": false, "checked_at": null},
         {"text": "Building Control sign-off for substructure received", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'frame_watertight', 'Frame & Wind/Watertight', 2, '[
         {"text": "Moisture readings recorded", "checked": false, "checked_at": null},
         {"text": "Cavity barriers inspected", "checked": false, "checked_at": null},
         {"text": "Structural engineer sign-off uploaded", "checked": false, "checked_at": null},
         {"text": "Roof confirmed watertight", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'pre_plaster_first_fix', 'Pre-Plaster / First Fix', 3, '[
         {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
         {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
         {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
         {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'pre_handover_pc', 'Pre-Handover / PC', 4, '[
         {"text": "Snagging list closed out", "checked": false, "checked_at": null},
         {"text": "O&M manuals received", "checked": false, "checked_at": null},
         {"text": "All statutory certificates received", "checked": false, "checked_at": null},
         {"text": "Final client walkthrough completed", "checked": false, "checked_at": null}
       ]'::jsonb)
    on conflict (plot_id, gate_key) do nothing;

    insert into public.handover_documents (project_id, plot_id, doc_key, title) values
      (new.project_id, new.id, 'building_control', 'Building Control Sign-off (Initial/Final)'),
      (new.project_id, new.id, 'air_acoustic_test', 'Air Permeability / Acoustic Test Certificates'),
      (new.project_id, new.id, 'elec_gas_certs', 'Electrical & Gas Safety Certificates'),
      (new.project_id, new.id, 'warranty_cover_note', 'NHBC/Structural Warranty Cover Note'),
      (new.project_id, new.id, 'om_manuals', 'Draft O&M Manuals')
    on conflict (plot_id, doc_key) do nothing;
  else
    insert into public.quality_gates (project_id, plot_id, gate_key, title, sort_order, checklist) values
      (new.project_id, new.id, 'flat_first_fix', '1st Fix (All Trades)', 1, '[
         {"text": "First fix electrical inspected", "checked": false, "checked_at": null},
         {"text": "First fix plumbing & heating inspected", "checked": false, "checked_at": null},
         {"text": "Insulation installed and inspected", "checked": false, "checked_at": null},
         {"text": "Pre-plaster inspection sign-off received", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'flat_second_fix', '2nd Fix (All Trades)', 2, '[
         {"text": "Second fix electrical complete and tested", "checked": false, "checked_at": null},
         {"text": "Second fix plumbing & heating complete and tested", "checked": false, "checked_at": null},
         {"text": "Sockets, switches and fittings installed", "checked": false, "checked_at": null},
         {"text": "Heating system commissioned", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'flat_kitchen_bathroom', 'Kitchen & Bathroom Fit', 3, '[
         {"text": "Kitchen units, worktops and appliances installed", "checked": false, "checked_at": null},
         {"text": "Bathroom / en-suite sanitaryware and tiling complete", "checked": false, "checked_at": null},
         {"text": "Water pressure and drainage tested", "checked": false, "checked_at": null},
         {"text": "Extractor fans tested", "checked": false, "checked_at": null}
       ]'::jsonb),
      (new.project_id, new.id, 'flat_pre_handover', 'Decoration, Flooring & Pre-Handover Snagging', 4, '[
         {"text": "Decoration (walls, ceilings, woodwork) complete", "checked": false, "checked_at": null},
         {"text": "Flooring / carpets fitted", "checked": false, "checked_at": null},
         {"text": "Unit snagging list closed out", "checked": false, "checked_at": null},
         {"text": "Final clean completed", "checked": false, "checked_at": null}
       ]'::jsonb)
    on conflict (plot_id, gate_key) do nothing;

    insert into public.handover_documents (project_id, plot_id, doc_key, title) values
      (new.project_id, new.id, 'flat_air_acoustic_test', 'Air Permeability / Acoustic Test Certificate'),
      (new.project_id, new.id, 'flat_elec_gas_certs', 'Electrical & Gas Safety Certificates'),
      (new.project_id, new.id, 'flat_epc', 'EPC (Energy Performance Certificate)'),
      (new.project_id, new.id, 'flat_warranty', 'Unit Warranty Cover Note'),
      (new.project_id, new.id, 'flat_om_manuals', 'O&M Manuals (Unit)')
    on conflict (plot_id, doc_key) do nothing;
  end if;

  insert into public.snag_lists (project_id, plot_id, title)
  values (new.project_id, new.id, new.plot_number)
  on conflict (plot_id) do nothing;

  return new;
end;
$$ language plpgsql;

-- ─── v16 ADDITIONS ────────────────────────────────────────────────
-- Multi-account collaboration: sites move from "every signed-in user
-- sees everything" to owned/invite-only. Whoever creates a site becomes
-- its owner; they can invite others (who join as collaborators with
-- full edit rights) via a shareable link. Deleting a site or managing
-- who has access stays owner-only. org_settings (company logo) and
-- storage stay shared across everyone, unchanged — they're
-- organisation-wide, not site-scoped.

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'collaborator' check (role in ('owner', 'collaborator')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
alter table public.project_members enable row level security;

-- Helper predicates used throughout the RLS policies below. security
-- definer so they can read project_members regardless of that table's
-- own RLS (avoids recursive-policy issues) — safe, since all they ever
-- expose is a true/false answer scoped to auth.uid(), the caller's own
-- identity, never another user's data.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_project_member(uuid) to authenticated;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role = 'owner'
  );
$$;
grant execute on function public.is_project_owner(uuid) to authenticated;

-- Whoever creates a site becomes its owner automatically.
create or replace function public.seed_project_owner()
returns trigger as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (project_id, user_id) do nothing;
  end if;
  -- created_by is nullable, so a project can in principle be created
  -- without one — nothing to seed here in that case; the fallback-owner
  -- repair further down (which runs every time this file does) picks it
  -- up and assigns someone next time, rather than this trigger raising
  -- and blocking project creation outright.
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_seed_project_owner on public.projects;
create trigger trg_seed_project_owner
after insert on public.projects
for each row execute function public.seed_project_owner();

-- Grandfather every existing user into every existing site, so nobody
-- loses access to something they could see before this shipped. Runs
-- exactly once — guarded on project_members still being empty, since
-- from here on every new site gets its owner via the trigger above and
-- every new collaborator via accepting an invite, so project_members is
-- never empty again after the first real site/join. Re-running this
-- file later (e.g. for a future migration) must NOT re-grant newly
-- signed-up users access to old sites, so this has to fire at most once.
do $$
begin
  if not exists (select 1 from public.project_members limit 1) then
    insert into public.project_members (project_id, user_id, role)
    select p.id, u.id, case when p.created_by = u.id then 'owner' else 'collaborator' end
    from public.projects p
    cross join auth.users u
    on conflict (project_id, user_id) do nothing;
  end if;
end $$;

-- Belt and braces: guarantee every site has at least one owner, even if
-- its created_by user no longer exists (deleted account) or was never
-- set. Cheap no-op once the above has run. Not gated to first-run only,
-- since a site could end up ownerless later too (e.g. its owner account
-- gets deleted) and ought to be repaired the next time this file runs.
do $$
declare
  proj record;
  fallback_user uuid;
begin
  for proj in
    select p.id from public.projects p
    where not exists (
      select 1 from public.project_members pm where pm.project_id = p.id and pm.role = 'owner'
    )
  loop
    select id into fallback_user from auth.users order by created_at asc limit 1;
    exit when fallback_user is null;
    insert into public.project_members (project_id, user_id, role)
    values (proj.id, fallback_user, 'owner')
    on conflict (project_id, user_id) do update set role = 'owner';
  end loop;
end $$;

-- Shareable invite link: a random code on the project itself. Null
-- until an owner first generates one. Regenerating invalidates the old
-- link (it's just overwritten); revoking sets it back to null.
alter table public.projects add column if not exists invite_code text unique;

create or replace function public.regenerate_invite_code(p_project_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the site owner can manage the invite link';
  end if;
  new_code := encode(gen_random_bytes(16), 'hex');
  update public.projects set invite_code = new_code where id = p_project_id;
  return new_code;
end;
$$;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;

create or replace function public.revoke_invite_code(p_project_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the site owner can manage the invite link';
  end if;
  update public.projects set invite_code = null where id = p_project_id;
end;
$$;
grant execute on function public.revoke_invite_code(uuid) to authenticated;

-- Joining is a function, not a direct table read/insert, so an invite
-- code can only ever be used as a targeted lookup (one guess at a time)
-- rather than something a broad RLS select policy could be tricked into
-- enumerating. Returns the joined project's id, or null if the code is
-- invalid/revoked.
create or replace function public.join_project_by_invite(invite_code_param text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  proj_id uuid;
begin
  select id into proj_id from public.projects where invite_code = invite_code_param;
  if proj_id is null then
    return null;
  end if;
  insert into public.project_members (project_id, user_id, role)
  values (proj_id, auth.uid(), 'collaborator')
  on conflict (project_id, user_id) do nothing;
  return proj_id;
end;
$$;
grant execute on function public.join_project_by_invite(text) to authenticated;

-- Member list with emails, for the Collaborators UI. Client code can't
-- query auth.users directly, so this does the join server-side —
-- security definer, but scoped to members of that one project only.
create or replace function public.get_project_members(p_project_id uuid)
returns table (member_id uuid, user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select pm.id, pm.user_id, u.email, pm.role, pm.created_at
  from public.project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and public.is_project_member(p_project_id)
  order by (pm.role = 'owner') desc, u.email;
$$;
grant execute on function public.get_project_members(uuid) to authenticated;

drop policy if exists "members read project_members" on public.project_members;
create policy "members read project_members" on public.project_members for select using (public.is_project_member(project_id));
drop policy if exists "owner or self delete project_members" on public.project_members;
create policy "owner or self delete project_members" on public.project_members for delete using (public.is_project_owner(project_id) or user_id = auth.uid());
-- No insert/update policy for regular clients — membership is only ever
-- granted via the trigger above (creating a site) or join_project_by_invite
-- (accepting one), both of which run as security definer.

-- ─── RLS rewrite: from "any signed-in user" to "members of this site" ───
drop policy if exists "authenticated read projects" on public.projects;
drop policy if exists "members read projects" on public.projects;
-- "or created_by = auth.uid()" isn't redundant with is_project_member():
-- creating a project and reading back its id via `.insert().select()`
-- (RETURNING) happens in the same statement as the AFTER INSERT trigger
-- that adds the creator to project_members, and RETURNING's own select
-- check can run before that trigger's row is visible to it — so without
-- this clause, creating a project intermittently fails to hand back its
-- own id. The creator can always see a row they just created regardless.
create policy "members read projects" on public.projects for select using (public.is_project_member(id) or created_by = auth.uid());
drop policy if exists "authenticated insert projects" on public.projects;
create policy "authenticated insert projects" on public.projects for insert with check (auth.role() = 'authenticated');
drop policy if exists "authenticated update projects" on public.projects;
drop policy if exists "members update projects" on public.projects;
create policy "members update projects" on public.projects for update using (public.is_project_member(id));
drop policy if exists "authenticated delete projects" on public.projects;
drop policy if exists "owner delete projects" on public.projects;
create policy "owner delete projects" on public.projects for delete using (public.is_project_owner(id));

drop policy if exists "authenticated read weekly_reports" on public.weekly_reports;
drop policy if exists "members read weekly_reports" on public.weekly_reports;
create policy "members read weekly_reports" on public.weekly_reports for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert weekly_reports" on public.weekly_reports;
drop policy if exists "members insert weekly_reports" on public.weekly_reports;
create policy "members insert weekly_reports" on public.weekly_reports for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update weekly_reports" on public.weekly_reports;
drop policy if exists "members update weekly_reports" on public.weekly_reports;
create policy "members update weekly_reports" on public.weekly_reports for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete weekly_reports" on public.weekly_reports;
drop policy if exists "members delete weekly_reports" on public.weekly_reports;
create policy "members delete weekly_reports" on public.weekly_reports for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read snag_items" on public.snag_items;
drop policy if exists "members read snag_items" on public.snag_items;
create policy "members read snag_items" on public.snag_items for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert snag_items" on public.snag_items;
drop policy if exists "members insert snag_items" on public.snag_items;
create policy "members insert snag_items" on public.snag_items for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update snag_items" on public.snag_items;
drop policy if exists "members update snag_items" on public.snag_items;
create policy "members update snag_items" on public.snag_items for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete snag_items" on public.snag_items;
drop policy if exists "members delete snag_items" on public.snag_items;
create policy "members delete snag_items" on public.snag_items for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read snag_lists" on public.snag_lists;
drop policy if exists "members read snag_lists" on public.snag_lists;
create policy "members read snag_lists" on public.snag_lists for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert snag_lists" on public.snag_lists;
drop policy if exists "members insert snag_lists" on public.snag_lists;
create policy "members insert snag_lists" on public.snag_lists for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update snag_lists" on public.snag_lists;
drop policy if exists "members update snag_lists" on public.snag_lists;
create policy "members update snag_lists" on public.snag_lists for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete snag_lists" on public.snag_lists;
drop policy if exists "members delete snag_lists" on public.snag_lists;
create policy "members delete snag_lists" on public.snag_lists for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read quality_gates" on public.quality_gates;
drop policy if exists "members read quality_gates" on public.quality_gates;
create policy "members read quality_gates" on public.quality_gates for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert quality_gates" on public.quality_gates;
drop policy if exists "members insert quality_gates" on public.quality_gates;
create policy "members insert quality_gates" on public.quality_gates for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update quality_gates" on public.quality_gates;
drop policy if exists "members update quality_gates" on public.quality_gates;
create policy "members update quality_gates" on public.quality_gates for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete quality_gates" on public.quality_gates;
drop policy if exists "members delete quality_gates" on public.quality_gates;
create policy "members delete quality_gates" on public.quality_gates for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read commercial_items" on public.commercial_items;
drop policy if exists "members read commercial_items" on public.commercial_items;
create policy "members read commercial_items" on public.commercial_items for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert commercial_items" on public.commercial_items;
drop policy if exists "members insert commercial_items" on public.commercial_items;
create policy "members insert commercial_items" on public.commercial_items for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update commercial_items" on public.commercial_items;
drop policy if exists "members update commercial_items" on public.commercial_items;
create policy "members update commercial_items" on public.commercial_items for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete commercial_items" on public.commercial_items;
drop policy if exists "members delete commercial_items" on public.commercial_items;
create policy "members delete commercial_items" on public.commercial_items for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read handover_documents" on public.handover_documents;
drop policy if exists "members read handover_documents" on public.handover_documents;
create policy "members read handover_documents" on public.handover_documents for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert handover_documents" on public.handover_documents;
drop policy if exists "members insert handover_documents" on public.handover_documents;
create policy "members insert handover_documents" on public.handover_documents for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update handover_documents" on public.handover_documents;
drop policy if exists "members update handover_documents" on public.handover_documents;
create policy "members update handover_documents" on public.handover_documents for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete handover_documents" on public.handover_documents;
drop policy if exists "members delete handover_documents" on public.handover_documents;
create policy "members delete handover_documents" on public.handover_documents for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read drawings" on public.drawings;
drop policy if exists "members read drawings" on public.drawings;
create policy "members read drawings" on public.drawings for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert drawings" on public.drawings;
drop policy if exists "members insert drawings" on public.drawings;
create policy "members insert drawings" on public.drawings for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update drawings" on public.drawings;
drop policy if exists "members update drawings" on public.drawings;
create policy "members update drawings" on public.drawings for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete drawings" on public.drawings;
drop policy if exists "members delete drawings" on public.drawings;
create policy "members delete drawings" on public.drawings for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read plots" on public.plots;
drop policy if exists "members read plots" on public.plots;
create policy "members read plots" on public.plots for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert plots" on public.plots;
drop policy if exists "members insert plots" on public.plots;
create policy "members insert plots" on public.plots for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update plots" on public.plots;
drop policy if exists "members update plots" on public.plots;
create policy "members update plots" on public.plots for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete plots" on public.plots;
drop policy if exists "members delete plots" on public.plots;
create policy "members delete plots" on public.plots for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read monthly_reports" on public.monthly_reports;
drop policy if exists "members read monthly_reports" on public.monthly_reports;
create policy "members read monthly_reports" on public.monthly_reports for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert monthly_reports" on public.monthly_reports;
drop policy if exists "members insert monthly_reports" on public.monthly_reports;
create policy "members insert monthly_reports" on public.monthly_reports for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated delete monthly_reports" on public.monthly_reports;
drop policy if exists "members delete monthly_reports" on public.monthly_reports;
create policy "members delete monthly_reports" on public.monthly_reports for delete using (public.is_project_member(project_id));

drop policy if exists "authenticated read blocks" on public.blocks;
drop policy if exists "members read blocks" on public.blocks;
create policy "members read blocks" on public.blocks for select using (public.is_project_member(project_id));
drop policy if exists "authenticated insert blocks" on public.blocks;
drop policy if exists "members insert blocks" on public.blocks;
create policy "members insert blocks" on public.blocks for insert with check (public.is_project_member(project_id));
drop policy if exists "authenticated update blocks" on public.blocks;
drop policy if exists "members update blocks" on public.blocks;
create policy "members update blocks" on public.blocks for update using (public.is_project_member(project_id));
drop policy if exists "authenticated delete blocks" on public.blocks;
drop policy if exists "members delete blocks" on public.blocks;
create policy "members delete blocks" on public.blocks for delete using (public.is_project_member(project_id));

-- ─── v17 ADDITIONS ────────────────────────────────────────────────
-- Snagging-only collaborators: a second membership tier for whoever
-- closes out snags on site (e.g. the main contractor's site manager)
-- but shouldn't see anything else — no weekly reports, quality gates,
-- commercial ledger, drawings, monthly reports, blocks, site details,
-- or the collaborators list itself. They get full CRUD on snag items
-- (close out, reject, flag a delay) and read-only access to plots and
-- drawings, just enough to navigate to and pin a snag.

alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_members add constraint project_members_role_check
  check (role in ('owner', 'collaborator', 'snagging'));

-- A member who can edit site content generally (owner or full
-- collaborator) — snagging-only members are members, but not editors.
create or replace function public.is_project_editor(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role in ('owner', 'collaborator')
  );
$$;
grant execute on function public.is_project_editor(uuid) to authenticated;

-- Lets a client find out its own role on a project even when it can't
-- read project_members generally (snagging-only members can't) —
-- reveals only the caller's own membership, never anyone else's.
create or replace function public.get_my_role(p_project_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.project_members where project_id = p_project_id and user_id = auth.uid();
$$;
grant execute on function public.get_my_role(uuid) to authenticated;

-- A second, independent invite link for snagging-only access —
-- separate from invite_code so an owner can hand out the right one to
-- the right person without a second step to change anyone's role.
alter table public.projects add column if not exists snagging_invite_code text unique;

create or replace function public.regenerate_snagging_invite_code(p_project_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the site owner can manage the invite link';
  end if;
  new_code := encode(gen_random_bytes(16), 'hex');
  update public.projects set snagging_invite_code = new_code where id = p_project_id;
  return new_code;
end;
$$;
grant execute on function public.regenerate_snagging_invite_code(uuid) to authenticated;

create or replace function public.revoke_snagging_invite_code(p_project_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the site owner can manage the invite link';
  end if;
  update public.projects set snagging_invite_code = null where id = p_project_id;
end;
$$;
grant execute on function public.revoke_snagging_invite_code(uuid) to authenticated;

-- Now checks both invite_code (-> collaborator) and snagging_invite_code
-- (-> snagging) — whichever one matches decides the role granted.
-- Still "on conflict do nothing": re-opening either link when already a
-- member (of any role) never changes an existing role, so an owner or
-- collaborator who opens a snagging link by mistake is never downgraded.
create or replace function public.join_project_by_invite(invite_code_param text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  proj_id uuid;
  member_role text;
begin
  select id, 'collaborator' into proj_id, member_role
  from public.projects where invite_code = invite_code_param;

  if proj_id is null then
    select id, 'snagging' into proj_id, member_role
    from public.projects where snagging_invite_code = invite_code_param;
  end if;

  if proj_id is null then
    return null;
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (proj_id, auth.uid(), member_role)
  on conflict (project_id, user_id) do nothing;
  return proj_id;
end;
$$;
grant execute on function public.join_project_by_invite(text) to authenticated;

-- Member list is now editor-only (was any member) — a snagging-only
-- member calling this gets back nothing, including their own row,
-- which is exactly how project.html hides the whole Collaborators
-- card from them.
create or replace function public.get_project_members(p_project_id uuid)
returns table (member_id uuid, user_id uuid, email text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select pm.id, pm.user_id, u.email, pm.role, pm.created_at
  from public.project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and public.is_project_editor(p_project_id)
  order by (pm.role = 'owner') desc, u.email;
$$;
grant execute on function public.get_project_members(uuid) to authenticated;

-- Rejected snags, and a delay flag that sits alongside Open rather than
-- replacing it — a snag can be open-and-flagged (still outstanding,
-- still counted as such) with a reason, until it's cleared or closed.
alter table public.snag_items drop constraint if exists snag_items_status_check;
alter table public.snag_items add constraint snag_items_status_check
  check (status in ('open', 'closed', 'rejected'));
alter table public.snag_items add column if not exists delay_flag boolean not null default false;
alter table public.snag_items add column if not exists delay_reason text;

-- ─── RLS: editor-only tables (snagging-only members see none of these) ───
drop policy if exists "members update projects" on public.projects;
drop policy if exists "editors update projects" on public.projects;
create policy "editors update projects" on public.projects for update using (public.is_project_editor(id));

drop policy if exists "members read project_members" on public.project_members;
drop policy if exists "editors read project_members" on public.project_members;
create policy "editors read project_members" on public.project_members for select using (public.is_project_editor(project_id));

drop policy if exists "members read weekly_reports" on public.weekly_reports;
drop policy if exists "editors read weekly_reports" on public.weekly_reports;
create policy "editors read weekly_reports" on public.weekly_reports for select using (public.is_project_editor(project_id));
drop policy if exists "members insert weekly_reports" on public.weekly_reports;
drop policy if exists "editors insert weekly_reports" on public.weekly_reports;
create policy "editors insert weekly_reports" on public.weekly_reports for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update weekly_reports" on public.weekly_reports;
drop policy if exists "editors update weekly_reports" on public.weekly_reports;
create policy "editors update weekly_reports" on public.weekly_reports for update using (public.is_project_editor(project_id));
drop policy if exists "members delete weekly_reports" on public.weekly_reports;
drop policy if exists "editors delete weekly_reports" on public.weekly_reports;
create policy "editors delete weekly_reports" on public.weekly_reports for delete using (public.is_project_editor(project_id));

drop policy if exists "members insert snag_lists" on public.snag_lists;
drop policy if exists "editors insert snag_lists" on public.snag_lists;
create policy "editors insert snag_lists" on public.snag_lists for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update snag_lists" on public.snag_lists;
drop policy if exists "editors update snag_lists" on public.snag_lists;
create policy "editors update snag_lists" on public.snag_lists for update using (public.is_project_editor(project_id));
drop policy if exists "members delete snag_lists" on public.snag_lists;
drop policy if exists "editors delete snag_lists" on public.snag_lists;
create policy "editors delete snag_lists" on public.snag_lists for delete using (public.is_project_editor(project_id));
-- snag_lists read stays member-level — a snagging-only member needs to
-- find a plot's list to open it.

drop policy if exists "members read quality_gates" on public.quality_gates;
drop policy if exists "editors read quality_gates" on public.quality_gates;
create policy "editors read quality_gates" on public.quality_gates for select using (public.is_project_editor(project_id));
drop policy if exists "members insert quality_gates" on public.quality_gates;
drop policy if exists "editors insert quality_gates" on public.quality_gates;
create policy "editors insert quality_gates" on public.quality_gates for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update quality_gates" on public.quality_gates;
drop policy if exists "editors update quality_gates" on public.quality_gates;
create policy "editors update quality_gates" on public.quality_gates for update using (public.is_project_editor(project_id));
drop policy if exists "members delete quality_gates" on public.quality_gates;
drop policy if exists "editors delete quality_gates" on public.quality_gates;
create policy "editors delete quality_gates" on public.quality_gates for delete using (public.is_project_editor(project_id));

drop policy if exists "members read commercial_items" on public.commercial_items;
drop policy if exists "editors read commercial_items" on public.commercial_items;
create policy "editors read commercial_items" on public.commercial_items for select using (public.is_project_editor(project_id));
drop policy if exists "members insert commercial_items" on public.commercial_items;
drop policy if exists "editors insert commercial_items" on public.commercial_items;
create policy "editors insert commercial_items" on public.commercial_items for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update commercial_items" on public.commercial_items;
drop policy if exists "editors update commercial_items" on public.commercial_items;
create policy "editors update commercial_items" on public.commercial_items for update using (public.is_project_editor(project_id));
drop policy if exists "members delete commercial_items" on public.commercial_items;
drop policy if exists "editors delete commercial_items" on public.commercial_items;
create policy "editors delete commercial_items" on public.commercial_items for delete using (public.is_project_editor(project_id));

drop policy if exists "members read handover_documents" on public.handover_documents;
drop policy if exists "editors read handover_documents" on public.handover_documents;
create policy "editors read handover_documents" on public.handover_documents for select using (public.is_project_editor(project_id));
drop policy if exists "members insert handover_documents" on public.handover_documents;
drop policy if exists "editors insert handover_documents" on public.handover_documents;
create policy "editors insert handover_documents" on public.handover_documents for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update handover_documents" on public.handover_documents;
drop policy if exists "editors update handover_documents" on public.handover_documents;
create policy "editors update handover_documents" on public.handover_documents for update using (public.is_project_editor(project_id));
drop policy if exists "members delete handover_documents" on public.handover_documents;
drop policy if exists "editors delete handover_documents" on public.handover_documents;
create policy "editors delete handover_documents" on public.handover_documents for delete using (public.is_project_editor(project_id));

drop policy if exists "members insert drawings" on public.drawings;
drop policy if exists "editors insert drawings" on public.drawings;
create policy "editors insert drawings" on public.drawings for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update drawings" on public.drawings;
drop policy if exists "editors update drawings" on public.drawings;
create policy "editors update drawings" on public.drawings for update using (public.is_project_editor(project_id));
drop policy if exists "members delete drawings" on public.drawings;
drop policy if exists "editors delete drawings" on public.drawings;
create policy "editors delete drawings" on public.drawings for delete using (public.is_project_editor(project_id));
-- drawings read stays member-level — Pinpoint Snagging needs a
-- snagging-only member to be able to view (not upload) floor plans to
-- pin a snag to one.

drop policy if exists "members insert plots" on public.plots;
drop policy if exists "editors insert plots" on public.plots;
create policy "editors insert plots" on public.plots for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update plots" on public.plots;
drop policy if exists "editors update plots" on public.plots;
create policy "editors update plots" on public.plots for update using (public.is_project_editor(project_id));
drop policy if exists "members delete plots" on public.plots;
drop policy if exists "editors delete plots" on public.plots;
create policy "editors delete plots" on public.plots for delete using (public.is_project_editor(project_id));
-- plots read stays member-level — a snagging-only member needs the
-- plot list to navigate to each one's snag list.

drop policy if exists "members read monthly_reports" on public.monthly_reports;
drop policy if exists "editors read monthly_reports" on public.monthly_reports;
create policy "editors read monthly_reports" on public.monthly_reports for select using (public.is_project_editor(project_id));
drop policy if exists "members insert monthly_reports" on public.monthly_reports;
drop policy if exists "editors insert monthly_reports" on public.monthly_reports;
create policy "editors insert monthly_reports" on public.monthly_reports for insert with check (public.is_project_editor(project_id));
drop policy if exists "members delete monthly_reports" on public.monthly_reports;
drop policy if exists "editors delete monthly_reports" on public.monthly_reports;
create policy "editors delete monthly_reports" on public.monthly_reports for delete using (public.is_project_editor(project_id));

drop policy if exists "members read blocks" on public.blocks;
drop policy if exists "editors read blocks" on public.blocks;
create policy "editors read blocks" on public.blocks for select using (public.is_project_editor(project_id));
drop policy if exists "members insert blocks" on public.blocks;
drop policy if exists "editors insert blocks" on public.blocks;
create policy "editors insert blocks" on public.blocks for insert with check (public.is_project_editor(project_id));
drop policy if exists "members update blocks" on public.blocks;
drop policy if exists "editors update blocks" on public.blocks;
create policy "editors update blocks" on public.blocks for update using (public.is_project_editor(project_id));
drop policy if exists "members delete blocks" on public.blocks;
drop policy if exists "editors delete blocks" on public.blocks;
create policy "editors delete blocks" on public.blocks for delete using (public.is_project_editor(project_id));

-- snag_items and plots'/drawings'/snag_lists' read stay untouched —
-- every member, snagging-only included, keeps full CRUD on snag_items
-- (that's the whole point) and read access to plots/drawings/snag_lists
-- to navigate to them.
