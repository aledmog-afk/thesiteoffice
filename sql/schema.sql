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
  -- gen_random_uuid() rather than pgcrypto's gen_random_bytes() — it's
  -- built into Postgres core (13+), so it needs no extension lookup at
  -- all, unlike gen_random_bytes() which Supabase installs into an
  -- "extensions" schema this function's locked-down search_path can't
  -- see. Stripping the dashes gives the same 32-hex-char shape as
  -- before; nothing else assumes a particular code format.
  new_code := replace(gen_random_uuid()::text, '-', '');
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
  -- see regenerate_invite_code() above for why gen_random_uuid() rather
  -- than pgcrypto's gen_random_bytes().
  new_code := replace(gen_random_uuid()::text, '-', '');
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

-- ─── v18 ADDITIONS ────────────────────────────────────────────────
-- General (not-plot-specific) snag lists — for a site walk touching
-- several plots and/or external/site-wide issues in one sheet, rather
-- than one plot's own list. snag_lists.plot_id was already nullable
-- (multiple null rows already coexist fine under its unique index,
-- from v8's own use of a null plot_id for pre-migration legacy lists)
-- — a client can now create additional null-plot_id lists on purpose,
-- titled by hand instead of taking a plot's name. Each item in one of
-- these records its own plot here, since one such list can span many;
-- left null for a genuinely external/site-wide issue that isn't any
-- one plot. Items in an ordinary plot-specific list leave this unset —
-- their plot is already implied by the list itself.
alter table public.snag_items add column if not exists plot_id uuid references public.plots(id) on delete set null;

-- ─── v19 ADDITIONS ────────────────────────────────────────────────
-- H&S (Health & Safety) audits — a separate section per site, expected
-- monthly. "internal" audits are filled in on a fixed condensed
-- checklist (HS_CHECKLIST in tracker/js/app.js) with a
-- Compliant/Non-Compliant/N/A/Good Practice status per item, plus a
-- Low/Medium/High traffic-light severity on any Non-Compliant one.
-- "external" audits are just an uploaded document (e.g. a third-party
-- SHE inspection) with no checklist breakdown — file_url/file_name
-- only. `month` is the first day of the calendar month this audit
-- counts toward (independent of conducted_date, so a late upload can
-- still be logged against the month it actually covers), matching
-- monthly_reports.month's own format so both can be looked up with a
-- single equality match rather than a date-range query.
create table if not exists public.hs_audits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  audit_type text not null check (audit_type in ('internal', 'external')),
  month date not null,
  conducted_by text,
  conducted_date date not null default current_date,
  notes text,
  file_url text,
  file_name text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists hs_audits_project_month_idx on public.hs_audits (project_id, month);

alter table public.hs_audits enable row level security;
drop policy if exists "editors read hs_audits" on public.hs_audits;
create policy "editors read hs_audits" on public.hs_audits for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert hs_audits" on public.hs_audits;
create policy "editors insert hs_audits" on public.hs_audits for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update hs_audits" on public.hs_audits;
create policy "editors update hs_audits" on public.hs_audits for update using (public.is_project_editor(project_id));
drop policy if exists "editors delete hs_audits" on public.hs_audits;
create policy "editors delete hs_audits" on public.hs_audits for delete using (public.is_project_editor(project_id));

-- One row per HS_CHECKLIST entry on an internal audit (external audits
-- have none). section/item_name are plain-text copies taken at
-- creation time, not a foreign key into that constant, so editing the
-- checklist later never rewrites an already-completed audit's wording.
create table if not exists public.hs_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.hs_audits(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  section text not null,
  item_name text not null,
  status text not null default 'compliant' check (status in ('compliant', 'non_compliant', 'na', 'good_practice')),
  severity text check (severity in ('low', 'medium', 'high')),
  notes text,
  photo_url text,
  sort_order integer not null default 0
);
create index if not exists hs_audit_items_audit_idx on public.hs_audit_items (audit_id);

alter table public.hs_audit_items enable row level security;
drop policy if exists "editors read hs_audit_items" on public.hs_audit_items;
create policy "editors read hs_audit_items" on public.hs_audit_items for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert hs_audit_items" on public.hs_audit_items;
create policy "editors insert hs_audit_items" on public.hs_audit_items for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update hs_audit_items" on public.hs_audit_items;
create policy "editors update hs_audit_items" on public.hs_audit_items for update using (public.is_project_editor(project_id));
drop policy if exists "editors delete hs_audit_items" on public.hs_audit_items;
create policy "editors delete hs_audit_items" on public.hs_audit_items for delete using (public.is_project_editor(project_id));

-- Frozen snapshot of that month's H&S audits at generation time, same
-- convention as monthly_reports' other jsonb columns: [{ audit_type,
-- conducted_by, conducted_date, score_pct, flagged_count, file_url,
-- file_name }]. Deliberately not a foreign key list — a monthly
-- report's own record of what happened shouldn't change if an audit is
-- edited or deleted afterwards.
alter table public.monthly_reports add column if not exists hs_audits jsonb not null default '[]'::jsonb;

-- ─── v20 ADDITIONS ────────────────────────────────────────────────
-- Weekly report upgrades for use as a client-side Clerk of Works
-- compliance record: structured photo tagging (plot/area, inspection
-- category, compliance status, caption — added to each entry already
-- in weekly_reports.photos, no column of its own needed since a photo
-- missing these fields just renders with blank tags), a Labour & Site
-- Resource Tracker, Clerk of Works verification notes on progress
-- items (added to each entry already in progress_items, likewise no
-- new column), a structured Risk & Delays register, and a Statutory &
-- Testing Milestones log.

-- Labour & Site Resource Tracker: [{ id, trade, headcount,
-- activity_location, adequacy }]
alter table public.weekly_reports add column if not exists labour_records jsonb not null default '[]'::jsonb;

-- Structured risk/delay register, replacing the free-text issues_risks
-- field as the form's primary input going forward. issues_risks itself
-- is left in place, unused by the form, so historical free-text
-- entries are never lost — same "old column stays, unused" pattern as
-- progress_summary/next_week_plan/labour_on_site above: [{ id,
-- description, action_required, owner, target_date, impact }]
alter table public.weekly_reports add column if not exists risk_items jsonb not null default '[]'::jsonb;

-- Statutory testing / inspection milestone log: [{ id, type,
-- plot_area, date, outcome, notes }]
alter table public.weekly_reports add column if not exists statutory_milestones jsonb not null default '[]'::jsonb;

-- Monthly reports roll up that month's structured risk items (flattened
-- across weeks, same convention as commercial_items) — without this,
-- a monthly report's "Issues / Risks / Delays" section would silently
-- go blank for any month made up of reports created after this change,
-- since it previously only ever read the (now-unused-by-the-form)
-- issues_risks text field. The old text-based column/section stays for
-- already-generated reports and any report where issues_risks was
-- still set by hand.
alter table public.monthly_reports add column if not exists risk_items jsonb not null default '[]'::jsonb;

-- ─── v21 ADDITIONS ────────────────────────────────────────────────
-- Closes the remaining gaps against the legacy paper "Clerk of Works
-- Weekly Report" this app replaces: site-level contract/appointment
-- names shown on every report's letterhead (main contractor name/email
-- and contract_ref already existed), and four narrative fields the
-- paper form had that the app didn't yet capture. The paper form's
-- weekend weather rows (Saturday/Sunday) need no schema change at all
-- — weather_days is already a plain jsonb array; the form just writes
-- 7 entries into it instead of 5 going forward.

alter table public.projects add column if not exists employers_agent_name text;
alter table public.projects add column if not exists clerk_of_works_name text;
alter table public.projects add column if not exists site_manager_name text;
alter table public.projects add column if not exists contract_completion_date date;

alter table public.weekly_reports add column if not exists programme_comments text;
alter table public.weekly_reports add column if not exists site_housekeeping text;
alter table public.weekly_reports add column if not exists drawings_received text;
alter table public.weekly_reports add column if not exists visitors text;

-- Same "one array entry per week that had something to say, tagged with
-- which week" convention as health_safety_notes/issues_risks above.
alter table public.monthly_reports add column if not exists programme_comments jsonb not null default '[]'::jsonb;
alter table public.monthly_reports add column if not exists site_housekeeping jsonb not null default '[]'::jsonb;
alter table public.monthly_reports add column if not exists drawings_received jsonb not null default '[]'::jsonb;
alter table public.monthly_reports add column if not exists visitors jsonb not null default '[]'::jsonb;

-- ─── v22 ADDITIONS ────────────────────────────────────────────────
-- The monthly report's old "Plot Handovers" section listed every
-- plot's current gate/document completion every single month,
-- regardless of whether anything had changed — a full-site table that
-- only grows longer as a site fills up, mostly repeating the same
-- "fully approved" rows month after month. Replaced with an
-- achievement-based section: only plots that actually reached full
-- handover THAT calendar month are listed, and the section is left
-- out of the report entirely in a month where nothing was handed
-- over. That needs an actual point-in-time fact — when a plot became
-- fully handed over — which nothing captured before now.
alter table public.plots add column if not exists handed_over_at timestamptz;

-- ─── v23 ADDITIONS ────────────────────────────────────────────────
-- Internal Works Milestones: a second, more granular layer of per-plot
-- progress tracking alongside plots.progress_pct (the single top-level
-- "how complete is this plot" number, still set independently — see
-- below) and the existing 4 Quality Gates. Modelled directly on a real
-- client tracker spreadsheet: Timber Frame, Roof Covering, First/Second
-- Fix per trade, Kitchen, Bathroom, Decoration, Flooring, Clean,
-- Snagging — each stage tracked as its own 0-100%, not a fixed status
-- enum, since the source tracker records genuine partial completion
-- (e.g. plastering 80% through a plot), not just a done/not-done flag.
-- Deliberately independent of progress_pct — like Quality Gates,
-- nothing here is derived from or automatically feeds back into it;
-- both are separately maintained facts about a plot.
create table if not exists public.internal_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_id uuid not null references public.plots(id) on delete cascade,
  milestone_key text not null,
  title text not null,
  percent numeric not null default 0 check (percent >= 0 and percent <= 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (plot_id, milestone_key)
);

alter table public.internal_milestones enable row level security;
drop policy if exists "editors read internal_milestones" on public.internal_milestones;
create policy "editors read internal_milestones" on public.internal_milestones for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert internal_milestones" on public.internal_milestones;
create policy "editors insert internal_milestones" on public.internal_milestones for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update internal_milestones" on public.internal_milestones;
create policy "editors update internal_milestones" on public.internal_milestones for update using (public.is_project_editor(project_id));
drop policy if exists "editors delete internal_milestones" on public.internal_milestones;
create policy "editors delete internal_milestones" on public.internal_milestones for delete using (public.is_project_editor(project_id));

-- Extends seed_plot_defaults() (full body carried forward from v15,
-- unchanged apart from the two new insert blocks below) so every new
-- plot gets its Internal Works Milestones the same automatic way it
-- already gets its quality gates/documents/snag list. Standalone plots
-- get the full 16 stages; flats get 14 — Timber Frame and Roof
-- Covering are excluded for flats since that structural work already
-- lives on the block's own quality gates (Frame & Superstructure /
-- Roof & Building Envelope), same reasoning the existing flat gate set
-- already uses for excluding structural gates.
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

    insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order) values
      (new.project_id, new.id, 'timber_frame', 'Timber Frame', 1),
      (new.project_id, new.id, 'roof_covering', 'Roof Covering', 2),
      (new.project_id, new.id, 'carpentry_first_fix', 'Carpentry First Fix', 3),
      (new.project_id, new.id, 'electrical_first_fix', 'Electrical First Fix', 4),
      (new.project_id, new.id, 'mechanical_first_fix', 'Mechanical First Fix', 5),
      (new.project_id, new.id, 'dry_lining', 'Dry Lining', 6),
      (new.project_id, new.id, 'plastering', 'Plastering Works', 7),
      (new.project_id, new.id, 'kitchen', 'Kitchen', 8),
      (new.project_id, new.id, 'bathroom', 'Bathroom', 9),
      (new.project_id, new.id, 'second_fix_carpentry', 'Second Fix Carpentry', 10),
      (new.project_id, new.id, 'second_fix_mechanical', 'Second Fix Mechanical', 11),
      (new.project_id, new.id, 'second_fix_electrical', 'Second Fix Electrical', 12),
      (new.project_id, new.id, 'decoration', 'Decoration', 13),
      (new.project_id, new.id, 'flooring', 'Flooring', 14),
      (new.project_id, new.id, 'clean', 'Clean', 15),
      (new.project_id, new.id, 'snagging', 'Snagging', 16)
    on conflict (plot_id, milestone_key) do nothing;
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

    insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order) values
      (new.project_id, new.id, 'carpentry_first_fix', 'Carpentry First Fix', 1),
      (new.project_id, new.id, 'electrical_first_fix', 'Electrical First Fix', 2),
      (new.project_id, new.id, 'mechanical_first_fix', 'Mechanical First Fix', 3),
      (new.project_id, new.id, 'dry_lining', 'Dry Lining', 4),
      (new.project_id, new.id, 'plastering', 'Plastering Works', 5),
      (new.project_id, new.id, 'kitchen', 'Kitchen', 6),
      (new.project_id, new.id, 'bathroom', 'Bathroom', 7),
      (new.project_id, new.id, 'second_fix_carpentry', 'Second Fix Carpentry', 8),
      (new.project_id, new.id, 'second_fix_mechanical', 'Second Fix Mechanical', 9),
      (new.project_id, new.id, 'second_fix_electrical', 'Second Fix Electrical', 10),
      (new.project_id, new.id, 'decoration', 'Decoration', 11),
      (new.project_id, new.id, 'flooring', 'Flooring', 12),
      (new.project_id, new.id, 'clean', 'Clean', 13),
      (new.project_id, new.id, 'snagging', 'Snagging', 14)
    on conflict (plot_id, milestone_key) do nothing;
  end if;

  insert into public.snag_lists (project_id, plot_id, title)
  values (new.project_id, new.id, new.plot_number)
  on conflict (plot_id) do nothing;

  return new;
end;
$$ language plpgsql;

-- One-time backfill for every plot that already existed before this
-- feature — same "nothing already on site loses out" approach used
-- when quality gates/documents/snag lists were first introduced.
insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order)
select p.project_id, p.id, m.milestone_key, m.title, m.sort_order
from public.plots p
cross join (values
  ('timber_frame', 'Timber Frame', 1),
  ('roof_covering', 'Roof Covering', 2),
  ('carpentry_first_fix', 'Carpentry First Fix', 3),
  ('electrical_first_fix', 'Electrical First Fix', 4),
  ('mechanical_first_fix', 'Mechanical First Fix', 5),
  ('dry_lining', 'Dry Lining', 6),
  ('plastering', 'Plastering Works', 7),
  ('kitchen', 'Kitchen', 8),
  ('bathroom', 'Bathroom', 9),
  ('second_fix_carpentry', 'Second Fix Carpentry', 10),
  ('second_fix_mechanical', 'Second Fix Mechanical', 11),
  ('second_fix_electrical', 'Second Fix Electrical', 12),
  ('decoration', 'Decoration', 13),
  ('flooring', 'Flooring', 14),
  ('clean', 'Clean', 15),
  ('snagging', 'Snagging', 16)
) as m(milestone_key, title, sort_order)
where p.block_id is null
on conflict (plot_id, milestone_key) do nothing;

insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order)
select p.project_id, p.id, m.milestone_key, m.title, m.sort_order
from public.plots p
cross join (values
  ('carpentry_first_fix', 'Carpentry First Fix', 1),
  ('electrical_first_fix', 'Electrical First Fix', 2),
  ('mechanical_first_fix', 'Mechanical First Fix', 3),
  ('dry_lining', 'Dry Lining', 4),
  ('plastering', 'Plastering Works', 5),
  ('kitchen', 'Kitchen', 6),
  ('bathroom', 'Bathroom', 7),
  ('second_fix_carpentry', 'Second Fix Carpentry', 8),
  ('second_fix_mechanical', 'Second Fix Mechanical', 9),
  ('second_fix_electrical', 'Second Fix Electrical', 10),
  ('decoration', 'Decoration', 11),
  ('flooring', 'Flooring', 12),
  ('clean', 'Clean', 13),
  ('snagging', 'Snagging', 14)
) as m(milestone_key, title, sort_order)
where p.block_id is not null
on conflict (plot_id, milestone_key) do nothing;

-- ─── v24 ADDITIONS ────────────────────────────────────────────────
-- A second site's Internal Works tracker (Heol Crwys) uses two trade
-- stages Tudor Inn's tracker never had: Carpentry Finals (after 2nd
-- Fix Carpentry, before Decoration) and Mastic (after Flooring,
-- before Clean). Extends the shared milestone list — used for every
-- plot on every site, same as Quality Gates — to a proper superset
-- rather than special-casing one site's schema. Existing
-- Decoration/Flooring/Clean/Snagging rows shift to make room; the
-- shift amount (+1 for Decoration/Flooring, +2 for Clean/Snagging) is
-- the same whether a plot is standalone or a flat, since both stages
-- were inserted before all four regardless.
-- Each shift is keyed to the exact OLD sort_order it's moving away
-- from (13/14/15/16 for a standalone plot, 11/12/13/14 for a flat —
-- the v23 numbering), not a blanket "+1"/"+2" — a blanket shift would
-- silently re-shift an already-corrected row (or a plot seeded fresh
-- under this very migration, already at the right position) on every
-- later re-run of this file, which is exactly the kind of thing
-- schema.sql has to stay safe against.
update public.internal_milestones im set sort_order = im.sort_order + 1
from public.plots p
where im.plot_id = p.id and im.milestone_key = 'decoration'
  and ((p.block_id is null and im.sort_order = 13) or (p.block_id is not null and im.sort_order = 11));
update public.internal_milestones im set sort_order = im.sort_order + 1
from public.plots p
where im.plot_id = p.id and im.milestone_key = 'flooring'
  and ((p.block_id is null and im.sort_order = 14) or (p.block_id is not null and im.sort_order = 12));
update public.internal_milestones im set sort_order = im.sort_order + 2
from public.plots p
where im.plot_id = p.id and im.milestone_key = 'clean'
  and ((p.block_id is null and im.sort_order = 15) or (p.block_id is not null and im.sort_order = 13));
update public.internal_milestones im set sort_order = im.sort_order + 2
from public.plots p
where im.plot_id = p.id and im.milestone_key = 'snagging'
  and ((p.block_id is null and im.sort_order = 16) or (p.block_id is not null and im.sort_order = 14));

insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order)
select p.project_id, p.id, 'carpentry_finals', 'Carpentry Finals', case when p.block_id is null then 13 else 11 end
from public.plots p
on conflict (plot_id, milestone_key) do nothing;

insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order)
select p.project_id, p.id, 'mastic', 'Mastic', case when p.block_id is null then 16 else 14 end
from public.plots p
on conflict (plot_id, milestone_key) do nothing;

-- Extends seed_plot_defaults() again (full body carried forward from
-- v23) so every new plot gets the corrected 18/16-stage milestone set
-- (was 16/14) going forward.
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

    insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order) values
      (new.project_id, new.id, 'timber_frame', 'Timber Frame', 1),
      (new.project_id, new.id, 'roof_covering', 'Roof Covering', 2),
      (new.project_id, new.id, 'carpentry_first_fix', 'Carpentry First Fix', 3),
      (new.project_id, new.id, 'electrical_first_fix', 'Electrical First Fix', 4),
      (new.project_id, new.id, 'mechanical_first_fix', 'Mechanical First Fix', 5),
      (new.project_id, new.id, 'dry_lining', 'Dry Lining', 6),
      (new.project_id, new.id, 'plastering', 'Plastering Works', 7),
      (new.project_id, new.id, 'kitchen', 'Kitchen', 8),
      (new.project_id, new.id, 'bathroom', 'Bathroom', 9),
      (new.project_id, new.id, 'second_fix_carpentry', 'Second Fix Carpentry', 10),
      (new.project_id, new.id, 'second_fix_mechanical', 'Second Fix Mechanical', 11),
      (new.project_id, new.id, 'second_fix_electrical', 'Second Fix Electrical', 12),
      (new.project_id, new.id, 'carpentry_finals', 'Carpentry Finals', 13),
      (new.project_id, new.id, 'decoration', 'Decoration', 14),
      (new.project_id, new.id, 'flooring', 'Flooring', 15),
      (new.project_id, new.id, 'mastic', 'Mastic', 16),
      (new.project_id, new.id, 'clean', 'Clean', 17),
      (new.project_id, new.id, 'snagging', 'Snagging', 18)
    on conflict (plot_id, milestone_key) do nothing;
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

    insert into public.internal_milestones (project_id, plot_id, milestone_key, title, sort_order) values
      (new.project_id, new.id, 'carpentry_first_fix', 'Carpentry First Fix', 1),
      (new.project_id, new.id, 'electrical_first_fix', 'Electrical First Fix', 2),
      (new.project_id, new.id, 'mechanical_first_fix', 'Mechanical First Fix', 3),
      (new.project_id, new.id, 'dry_lining', 'Dry Lining', 4),
      (new.project_id, new.id, 'plastering', 'Plastering Works', 5),
      (new.project_id, new.id, 'kitchen', 'Kitchen', 6),
      (new.project_id, new.id, 'bathroom', 'Bathroom', 7),
      (new.project_id, new.id, 'second_fix_carpentry', 'Second Fix Carpentry', 8),
      (new.project_id, new.id, 'second_fix_mechanical', 'Second Fix Mechanical', 9),
      (new.project_id, new.id, 'second_fix_electrical', 'Second Fix Electrical', 10),
      (new.project_id, new.id, 'carpentry_finals', 'Carpentry Finals', 11),
      (new.project_id, new.id, 'decoration', 'Decoration', 12),
      (new.project_id, new.id, 'flooring', 'Flooring', 13),
      (new.project_id, new.id, 'mastic', 'Mastic', 14),
      (new.project_id, new.id, 'clean', 'Clean', 15),
      (new.project_id, new.id, 'snagging', 'Snagging', 16)
    on conflict (plot_id, milestone_key) do nothing;
  end if;

  insert into public.snag_lists (project_id, plot_id, title)
  values (new.project_id, new.id, new.plot_number)
  on conflict (plot_id) do nothing;

  return new;
end;
$$ language plpgsql;

-- ─── v25 ADDITIONS ────────────────────────────────────────────────
-- Specification documents: reference paperwork for a site (e.g. one
-- per house type or per trade), shown alongside Site Layout and Plot
-- Floor Plans on the Drawings page. Deliberately its own table rather
-- than reusing `drawings` with a null plot_number — specs are never
-- plot-scoped and never support pinning, so keeping them separate
-- avoids drawings.html's plot/pinning logic having to special-case
-- "a drawing that isn't really a drawing." Same shape and RLS as
-- `drawings` otherwise (a simple named-file list per project).
create table if not exists public.specifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  spec_name text not null,
  spec_url text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.specifications enable row level security;
drop policy if exists "members read specifications" on public.specifications;
create policy "members read specifications" on public.specifications for select using (public.is_project_member(project_id));
drop policy if exists "editors insert specifications" on public.specifications;
create policy "editors insert specifications" on public.specifications for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update specifications" on public.specifications;
create policy "editors update specifications" on public.specifications for update using (public.is_project_editor(project_id));
drop policy if exists "editors delete specifications" on public.specifications;
create policy "editors delete specifications" on public.specifications for delete using (public.is_project_editor(project_id));

-- ─── v26 ADDITIONS ────────────────────────────────────────────────
-- Organisations: the tenant boundary above "project." Every project
-- belongs to exactly one organisation; every organisation has one or
-- more members (admin/member). Project-level access (project_members:
-- owner/collaborator/snagging) is unchanged and still governs which of
-- an organisation's sites a given member can actually see — org
-- membership answers a different question ("is this person part of
-- this company at all"), enforced as an ADDITIONAL requirement layered
-- onto the existing per-project checks below, not a replacement for
-- them.
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;

-- Same security-definer pattern as is_project_member/is_project_owner
-- above — lets RLS policies (including the project-level ones rewritten
-- further down) check org membership without a recursive-policy problem
-- on organisation_members' own RLS.
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organisation_members
    where org_id = p_org_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_org_member(uuid) to authenticated;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organisation_members
    where org_id = p_org_id and user_id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_org_admin(uuid) to authenticated;

drop policy if exists "members read organisations" on public.organisations;
create policy "members read organisations" on public.organisations for select using (public.is_org_member(id));
drop policy if exists "admins update organisations" on public.organisations;
create policy "admins update organisations" on public.organisations for update using (public.is_org_admin(id));
-- No insert/delete policy for regular clients — an organisation is only
-- ever created via ensure_organisation() (security definer) below, and
-- deleting one (which would orphan every project in it) isn't something
-- this foundation supports yet.

drop policy if exists "members read organisation_members" on public.organisation_members;
create policy "members read organisation_members" on public.organisation_members for select using (public.is_org_member(org_id));
drop policy if exists "admin or self delete organisation_members" on public.organisation_members;
create policy "admin or self delete organisation_members" on public.organisation_members for delete using (public.is_org_admin(org_id) or user_id = auth.uid());
-- No insert/update policy for regular clients — same reasoning as
-- project_members: membership is only ever granted via
-- ensure_organisation() or join_project_by_invite(), both below.

-- Returns the caller's organisation id, creating a brand-new one (named
-- after their email) plus an admin membership row the first time they
-- need one — called from the client right before creating their first
-- project, so a new sign-up needs no separate "set up your organisation"
-- step. If the caller already belongs to one or more organisations
-- (the only current path to that is accepting an invite into someone
-- else's — see join_project_by_invite() below), this returns the
-- earliest one rather than creating a second: this app's UI supports a
-- single "current organisation" per user for now, not a switcher.
create or replace function public.ensure_organisation()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  existing_org uuid;
  new_org uuid;
  user_email text;
begin
  select org_id into existing_org
  from public.organisation_members
  where user_id = auth.uid()
  order by created_at asc
  limit 1;

  if existing_org is not null then
    return existing_org;
  end if;

  select email into user_email from auth.users where id = auth.uid();

  insert into public.organisations (name)
  values (coalesce(nullif(split_part(user_email, '@', 1), ''), 'My') || '''s Organisation')
  returning id into new_org;

  insert into public.organisation_members (org_id, user_id, role)
  values (new_org, auth.uid(), 'admin');

  return new_org;
end;
$$;
grant execute on function public.ensure_organisation() to authenticated;

-- Every project now belongs to an organisation. Nullable for now so the
-- backfill below can populate it before the not-null constraint (further
-- down) is enforced.
alter table public.projects add column if not exists org_id uuid references public.organisations(id);

-- Added here (ahead of the backfill block below, which writes to it) so
-- org_settings' own org_id exists before anything tries to populate it.
-- The rest of the org_settings scoping (constraints, RLS) happens in its
-- own section further down, once organisations definitely exist.
alter table public.org_settings add column if not exists org_id uuid references public.organisations(id);

-- One-time grandfather: if this database already has real project/
-- membership/settings data (i.e. this isn't a brand-new install), fold
-- all of it into a single default organisation, preserving exactly the
-- access every current user already has — never deletes or orphans
-- anything. Guarded on organisation_members being empty, so this fires
-- at most once; every user and project from here on gets an
-- organisation via ensure_organisation()/project creation/invite
-- acceptance instead.
do $$
declare
  default_org uuid;
begin
  if not exists (select 1 from public.organisation_members limit 1) then
    if exists (select 1 from public.projects limit 1)
       or exists (select 1 from public.project_members limit 1)
       or exists (select 1 from public.org_settings limit 1) then

      insert into public.organisations (name) values ('My Organisation') returning id into default_org;

      -- Every user who currently has access to at least one project
      -- joins the default org — admin if they own a project, member
      -- otherwise. This recreates real current access, not more.
      insert into public.organisation_members (org_id, user_id, role)
      select default_org, pm.user_id, case when bool_or(pm.role = 'owner') then 'admin' else 'member' end
      from public.project_members pm
      group by pm.user_id
      on conflict (org_id, user_id) do nothing;

      update public.projects set org_id = default_org where org_id is null;

      -- Opportunistic only — never deletes a pre-existing org_settings
      -- row for the (extremely unlikely) case where one exists with no
      -- projects/project_members at all.
      update public.org_settings set org_id = default_org where org_id is null;
    end if;
  end if;
end $$;

-- Belt and braces: any project that still has no org_id (e.g. one
-- inserted directly, bypassing the app, between deploys) is assigned to
-- its creator's own organisation, or a fresh one if the creator has
-- none either. Cheap no-op once every project has an org_id, which is
-- always true for anything created through the app from here on.
do $$
declare
  proj record;
  proj_org uuid;
begin
  for proj in select id, created_by from public.projects where org_id is null loop
    proj_org := null;
    if proj.created_by is not null then
      select org_id into proj_org from public.organisation_members where user_id = proj.created_by order by created_at asc limit 1;
    end if;
    if proj_org is null then
      insert into public.organisations (name) values ('My Organisation') returning id into proj_org;
      if proj.created_by is not null then
        insert into public.organisation_members (org_id, user_id, role) values (proj_org, proj.created_by, 'admin')
        on conflict (org_id, user_id) do nothing;
      end if;
    end if;
    update public.projects set org_id = proj_org where id = proj.id;
  end loop;
end $$;

alter table public.projects alter column org_id set not null;

-- Org-aware counterpart to the pre-existing "every site needs an owner"
-- repair further up this file (which predates organisations and can't
-- reference org_id) — if a project's owner isn't a member of that
-- project's own organisation, or it has no owner at all, fall back to
-- the earliest member of that SAME organisation, never an unrelated
-- user from a different one. No-op once every project's owner already
-- belongs to its org, which is always true going forward.
do $$
declare
  proj record;
  fallback_user uuid;
begin
  for proj in
    select p.id, p.org_id
    from public.projects p
    where not exists (
      select 1
      from public.project_members pm
      join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
      where pm.project_id = p.id and pm.role = 'owner'
    )
  loop
    select user_id into fallback_user from public.organisation_members where org_id = proj.org_id order by created_at asc limit 1;
    continue when fallback_user is null;
    insert into public.project_members (project_id, user_id, role) values (proj.id, fallback_user, 'owner')
    on conflict (project_id, user_id) do update set role = 'owner';
  end loop;
end $$;

-- Project creation now requires the creator to already belong to the
-- organisation they're creating it under — the client resolves this via
-- ensure_organisation() before inserting (see dashboard.html). Replaces
-- the old "any signed-in user" check.
drop policy if exists "authenticated insert projects" on public.projects;
drop policy if exists "org members insert projects" on public.projects;
create policy "org members insert projects" on public.projects for insert
  with check (org_id is not null and public.is_org_member(org_id));

-- ─── The organisation boundary rewrite ───────────────────────────
-- Every RLS policy on every one of this schema's 17 tables ultimately
-- calls one of these three functions — quality_gates, handover_documents,
-- internal_milestones, snag_items, weekly_reports, commercial_items,
-- drawings, specifications, hs_audits, hs_audit_items, monthly_reports,
-- blocks and plots all pass their own project_id straight into
-- is_project_member/is_project_editor, and project_members/projects
-- themselves use is_project_member/is_project_owner. Adding the
-- organisation check ONLY here therefore closes the boundary on every
-- table at once, including every child-of-child case, with no other
-- policy needing to change: a project_members row is no longer
-- sufficient on its own — the caller must also currently belong to that
-- project's organisation.
create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
    where pm.project_id = p_project_id and pm.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
    where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role = 'owner'
  );
$$;

create or replace function public.is_project_editor(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
    where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role in ('owner', 'collaborator')
  );
$$;

-- Accepting a project invite (either link) now also enrols the joiner
-- into that project's organisation — org membership is what the
-- functions above require underneath, and there's no separate "join the
-- company" step in this app, so folding it into the one invite flow
-- that already exists keeps the UX identical to before this migration.
create or replace function public.join_project_by_invite(invite_code_param text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  proj_id uuid;
  proj_org_id uuid;
  member_role text;
begin
  select id, org_id, 'collaborator' into proj_id, proj_org_id, member_role
  from public.projects where invite_code = invite_code_param;

  if proj_id is null then
    select id, org_id, 'snagging' into proj_id, proj_org_id, member_role
    from public.projects where snagging_invite_code = invite_code_param;
  end if;

  if proj_id is null then
    return null;
  end if;

  insert into public.organisation_members (org_id, user_id, role)
  values (proj_org_id, auth.uid(), 'member')
  on conflict (org_id, user_id) do nothing;

  insert into public.project_members (project_id, user_id, role)
  values (proj_id, auth.uid(), member_role)
  on conflict (project_id, user_id) do nothing;
  return proj_id;
end;
$$;
grant execute on function public.join_project_by_invite(text) to authenticated;

-- ─── org_settings: scope the company logo to its organisation ───
-- Was a single global row (id fixed to 1) readable/writable by any
-- signed-in user regardless of project. `id` is left in place, unused,
-- same "old column stays" convention as the rest of this schema — org_id
-- (added earlier above, ahead of the backfill block that populates it)
-- is the real identity from here on.
alter table public.org_settings drop constraint if exists org_settings_pkey;
alter table public.org_settings drop constraint if exists org_settings_id_check;

-- Defensive backfill for any org_settings row the grandfather block
-- above didn't reach (it only runs once) — opportunistic, never deletes.
update public.org_settings
set org_id = (select id from public.organisations order by created_at asc limit 1)
where org_id is null and exists (select 1 from public.organisations limit 1);

alter table public.org_settings drop constraint if exists org_settings_org_id_key;
alter table public.org_settings add constraint org_settings_org_id_key unique (org_id);

drop policy if exists "authenticated read org_settings" on public.org_settings;
drop policy if exists "authenticated insert org_settings" on public.org_settings;
drop policy if exists "authenticated update org_settings" on public.org_settings;
drop policy if exists "members read org_settings" on public.org_settings;
create policy "members read org_settings" on public.org_settings for select using (public.is_org_member(org_id));
drop policy if exists "members insert org_settings" on public.org_settings;
create policy "members insert org_settings" on public.org_settings for insert with check (public.is_org_member(org_id));
drop policy if exists "members update org_settings" on public.org_settings;
create policy "members update org_settings" on public.org_settings for update using (public.is_org_member(org_id));

-- ─── v27 ADDITIONS ────────────────────────────────────────────────
-- Storage hardening: the "site-photos" bucket's write policies (v1,
-- top of this file) were never tightened past "any authenticated user,
-- any path" — org isolation stopped at the database tables. A user from
-- Organisation A could always have uploaded into, overwritten, or
-- deleted an object under Organisation B's project folder, entirely
-- independent of the organisation boundary added above. Fixed the same
-- way every other write in this app is authorised: by re-deriving the
-- real project (and its organisation) from the object's own path
-- server-side, and checking real project membership — never by trusting
-- a client-supplied id.

-- Real upload limits, enforced by Supabase's storage engine itself, not
-- just RLS — a request over either bound is rejected before the object
-- is even written, regardless of what the client claims.
--   50 MB: every photo already passes through client-side compression
--   (WebP/JPEG, capped at 1920-2560px) before upload, so a legitimate
--   photo is normally well under 5 MB — the ceiling exists for the
--   uncompressed PDFs this app also stores (drawings, specifications,
--   handover certificates), which can legitimately run to tens of MB
--   for a real architectural drawing set.
--   MIME allow-list: every image type actually produced by this app's
--   own compression step (jpeg/webp) or a real phone camera before
--   compression can run (heic/heif — compression silently falls back to
--   the original file if the browser can't decode it), PDF (drawings,
--   specs, handover certs, external H&S audits), and the common office
--   formats the Specifications feature deliberately accepts "any
--   document type" for. Deliberately EXCLUDES image/svg+xml and any
--   text/html-shaped type: an SVG can carry an embedded <script>, and
--   nothing in this app has ever asked to upload one — this is the one
--   real gap this allow-list closes, not just a size cap.
update storage.buckets
set file_size_limit = 52428800, -- 50 MB, see above
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv'
    ]
where id = 'site-photos';

-- Re-derives the real project_id an object path is actually FOR, from
-- the path alone — every upload in this app writes to one of two
-- shapes: "<project_id>/<area>/<file>" (uploadPhoto/uploadImage) or
-- "drawings/<project_id>/<area>/<file>" (uploadDrawing, which prefixes
-- every path it's given with "drawings/"). A candidate that isn't
-- actually a uuid (e.g. "org-logo", or anything malformed) returns
-- null rather than raising — callers treat null as "not project-scoped",
-- never as "allowed".
create or replace function public.site_photos_path_parts(object_name text)
returns table (project_id uuid, area text)
language plpgsql immutable
as $$
declare
  seg1 text := (storage.foldername(object_name))[1];
  seg2 text := (storage.foldername(object_name))[2];
  seg3 text := (storage.foldername(object_name))[3];
  candidate text;
  candidate_area text;
begin
  if seg1 = 'drawings' then
    candidate := seg2;
    candidate_area := seg3;
  else
    candidate := seg1;
    candidate_area := seg2;
  end if;

  if candidate is null or candidate !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return;
  end if;

  project_id := candidate::uuid;
  area := candidate_area;
  return next;
end;
$$;

-- The actual authorisation check a storage.objects policy calls. Two
-- shapes: the company logo ("org-logo/...", not project-scoped at all —
-- any org member may replace it, same as before; the real authorisation
-- for which organisation's org_settings row ends up pointing at the
-- resulting file is enforced separately by org_settings' own RLS,
-- unchanged by this migration) and everything else, which must resolve
-- to a real project via site_photos_path_parts() above. Within that,
-- "snags" photos (raised from snag items and drawing pins) follow
-- snag_items' own access rule — any project member, including a
-- snagging-only one, exactly like every other snag_items read/write in
-- this app; every other area (reports, handover, hs-audits,
-- site-layout, specifications, drawings) follows the editor-only rule
-- the owning table itself already enforces.
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
grant execute on function public.site_photos_authorized(text) to authenticated;

-- Read stays public (object URLs are unguessable UUID paths, same
-- "public bucket, private-by-obscurity" model this app already uses
-- throughout — tightening this would break printable report/snag-sheet
-- views and shared links that aren't always loaded in an authenticated
-- session). Re-created here only so re-running this file stays
-- idempotent.
drop policy if exists "public read site-photos" on storage.objects;
create policy "public read site-photos" on storage.objects
  for select using (bucket_id = 'site-photos');

drop policy if exists "authenticated upload site-photos" on storage.objects;
drop policy if exists "project editors upload site-photos" on storage.objects;
create policy "project editors upload site-photos" on storage.objects
  for insert with check (bucket_id = 'site-photos' and public.site_photos_authorized(name));

drop policy if exists "authenticated delete site-photos" on storage.objects;
drop policy if exists "project editors delete site-photos" on storage.objects;
create policy "project editors delete site-photos" on storage.objects
  for delete using (bucket_id = 'site-photos' and public.site_photos_authorized(name));

-- No update policy, same as before this migration — every upload in
-- this app always writes a fresh random filename (see uploadPhoto() in
-- tracker/js/app.js), so in-place overwrite was never a real use case;
-- leaving it unpolicied keeps it default-denied.

-- ─── v28 ADDITIONS: audit trail ───
--
-- A generic, organisation-aware log of who changed what and when across
-- the tables that matter for accountability. Scope is deliberately
-- limited to 8 tables (see below) rather than "every table" — the goal
-- is a trustworthy record of meaningful changes, not a log of
-- everything. INSERT/UPDATE/DELETE only; reads/UI interaction are never
-- audited. This is infrastructure only — no history UI, no retention
-- policy, no admin edit/delete mechanism is built here.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- on delete set null (never cascade): deleting a project/org must
  -- never destroy the audit history that documents what happened to it.
  -- Known accepted limitation: once org_id/project_id is nulled this
  -- way, the row becomes unreachable under the SELECT policy below
  -- (which requires a live project/org to check access against) except
  -- to a superuser. Retention/archival of orphaned rows is out of scope
  -- for this priority.
  org_id uuid references public.organisations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  -- The acting user, never client-supplied — see write_audit_log()
  -- below, which reads this from auth.uid() (the session's own
  -- authenticated identity), not from any value the row itself carries.
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid not null,
  -- null for INSERT (nothing existed before), null for DELETE (nothing
  -- exists after) — never both null, never both populated for an
  -- INSERT/DELETE.
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is 'Append-only change history for INSERT/UPDATE/DELETE on the audited tables. Rows are only ever written by write_audit_log() triggers (security definer) — there is deliberately no INSERT/UPDATE/DELETE RLS policy for ordinary clients, so this table is tamper-resistant from any authenticated application context. Audit trail begins from this migration onward; no historical data is backfilled.';

-- Query shapes this supports: "everything in this org", "everything in
-- this project" (both newest-first, the natural reading order), "every
-- change by this user", and "history of this one record". Deliberately
-- not indexing old_data/new_data (no free-text search requirement yet)
-- or created_at alone (redundant given the two composite indexes).
create index if not exists audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index if not exists audit_log_project_created_idx on public.audit_log (project_id, created_at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id);
create index if not exists audit_log_table_record_idx on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;

-- Mirrors each underlying table's own real SELECT policy rather than a
-- blanket "any org member can read" rule. Several audited tables
-- (project_members, quality_gates, handover_documents, commercial_items,
-- weekly_reports) are editor-only to read, not member-level — verified
-- directly against this file's own policies, not assumed. Auditing must
-- not become a backdoor that lets a snagging-only member read history
-- for data they could never read directly. projects/snag_items are
-- member-level (matching their own SELECT policies); org_settings is
-- org-member-level; everything else defaults to editor-level, fail
-- closed for any future table added to the audited set.
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

  if p_project_id is null then
    return false;
  end if;

  if p_table_name in ('projects', 'snag_items') then
    return public.is_project_member(p_project_id);
  end if;

  return public.is_project_editor(p_project_id);
end;
$$;
grant execute on function public.can_read_audit_row(text, uuid, uuid) to authenticated;

drop policy if exists "read own audit history" on public.audit_log;
create policy "read own audit history" on public.audit_log
  for select using (public.can_read_audit_row(table_name, project_id, org_id));

-- Deliberately no insert/update/delete policy: RLS is enabled and zero
-- policies exist for those operations, so Postgres denies them outright
-- to every role except the table owner / a security-definer function
-- that bypasses RLS — the same "enabled, unpolicied = default-denied"
-- pattern already used elsewhere in this schema (e.g. handover_documents
-- has no UPDATE policy). The only way a row can ever be inserted is via
-- write_audit_log() below, which runs as security definer.

-- One generic trigger function reused across every audited table rather
-- than one per table. It uses to_jsonb(NEW/OLD)->>'column' (dynamic key
-- lookup) instead of static field access (NEW.project_id etc.)
-- specifically so it stays safe to attach to differently-shaped rows —
-- projects has no project_id column (the row IS the project), and
-- org_settings has no project_id at all.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    -- org_settings.id is a legacy smallint singleton (always 1), not a
    -- uuid — the row's real identity is its org_id, so use that as the
    -- audit record_id instead of the generic id-based column.
    v_project_id := null;
    v_org_id := (v_record->>'org_id')::uuid;
    v_record_id := v_org_id;
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
$$;

-- Audited tables: projects, project_members, quality_gates,
-- handover_documents, commercial_items and snag_items were named
-- explicitly by this priority's brief (quality/handover/commercial) or
-- are the core project/membership/snagging records those depend on.
-- weekly_reports and org_settings were added after inspection as the
-- other genuinely high-value, low-noise tables (a weekly report is a
-- formal record; org name/logo changes are rare and worth tracking).
-- Deliberately NOT audited yet: plots, blocks, drawings, specifications,
-- internal_milestones, monthly_reports, hs_audits/hs_audit_items,
-- snag_lists, organisation_members — straightforward to extend later
-- (just add a trigger, same function) but out of scope for this pass;
-- see tracker/README.md.
drop trigger if exists trg_audit_projects on public.projects;
create trigger trg_audit_projects
  after insert or update or delete on public.projects
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_project_members on public.project_members;
create trigger trg_audit_project_members
  after insert or update or delete on public.project_members
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_quality_gates on public.quality_gates;
create trigger trg_audit_quality_gates
  after insert or update or delete on public.quality_gates
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_handover_documents on public.handover_documents;
create trigger trg_audit_handover_documents
  after insert or update or delete on public.handover_documents
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_commercial_items on public.commercial_items;
create trigger trg_audit_commercial_items
  after insert or update or delete on public.commercial_items
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_snag_items on public.snag_items;
create trigger trg_audit_snag_items
  after insert or update or delete on public.snag_items
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_weekly_reports on public.weekly_reports;
create trigger trg_audit_weekly_reports
  after insert or update or delete on public.weekly_reports
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_org_settings on public.org_settings;
create trigger trg_audit_org_settings
  after insert or update or delete on public.org_settings
  for each row execute function public.write_audit_log();

-- ─── v29 ADDITIONS: Actions Engine ───
--
-- A generic, project-scoped accountable action: something happens ->
-- an action is created -> an owner is assigned -> a due date -> a
-- status -> completion. Foundation for future modules (inspections,
-- defects, risk, commercial control) — those integrations are NOT
-- built here, only the reusable engine itself.

-- Parameterised twin of is_project_editor() — takes an explicit
-- p_user_id rather than always using auth.uid(), so it can validate
-- someone OTHER than the caller (the assignee) is a legitimate editor
-- of the project, not just that the caller is. Mirrors is_project_editor
-- exactly (owner/collaborator, joined through organisation_members).
create or replace function public.is_project_editor_user(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
    where pm.project_id = p_project_id and pm.user_id = p_user_id and pm.role in ('owner', 'collaborator')
  );
$$;
grant execute on function public.is_project_editor_user(uuid, uuid) to authenticated;

-- Deliberately simple fixed transition table, not a workflow engine.
-- completed -> open is the one explicit "reopen" path; cancelled is
-- terminal (no transitions out); same-status "changes" (re-saving other
-- fields without touching status) are always allowed and never reach
-- this function at all — see actions_before_write() below.
create or replace function public.valid_action_status_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_from, p_to) in (
    ('open', 'in_progress'),
    ('open', 'completed'),
    ('open', 'cancelled'),
    ('in_progress', 'blocked'),
    ('in_progress', 'completed'),
    ('in_progress', 'cancelled'),
    ('blocked', 'in_progress'),
    ('blocked', 'cancelled'),
    ('completed', 'open')
  );
$$;

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  -- Always trigger-derived from project_id below, never trusted from the
  -- client — same principle audit_log's org_id already uses. No ON
  -- DELETE clause, matching projects.org_id's own convention (orgs are
  -- never deleted through this app; if one ever were, this would
  -- correctly block it rather than silently orphaning actions).
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  -- References auth.users directly rather than project_members (which
  -- is per-project membership, not identity) — the safest existing
  -- pattern already used by created_by throughout this schema. Who is a
  -- LEGITIMATE assignee for a given project is enforced separately, in
  -- the trigger below and in RLS, not by the foreign key itself.
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes tied to real query shapes: a project's action list (optionally
-- filtered by status or sorted by due date), and "my open actions"
-- across projects. org_id is indexed on its own to support isolation
-- queries and keep it from ever showing up as an unindexed foreign key.
create index if not exists actions_project_status_idx on public.actions (project_id, status);
create index if not exists actions_project_due_date_idx on public.actions (project_id, due_date);
create index if not exists actions_assigned_status_idx on public.actions (assigned_to, status);
create index if not exists actions_org_id_idx on public.actions (org_id);

-- Server-side authority for everything the frontend also checks for UX:
-- org_id derivation, created_by/created_at immutability, updated_at,
-- assignee legitimacy, status-transition validity, and completed_at
-- set/clear. Client-supplied values for any of these are overridden,
-- not merely validated, so there is no way to bypass this from a direct
-- API call. security definer so it can read public.projects regardless
-- of the caller's own row-level access to that specific row (same
-- reasoning as write_audit_log()).
create or replace function public.actions_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'actions.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if new.assigned_to is not null and not public.is_project_editor_user(new.project_id, new.assigned_to) then
    raise exception 'assigned_to must be a project editor (owner or collaborator) for this project';
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    if new.status <> old.status and not public.valid_action_status_transition(old.status, new.status) then
      raise exception 'Invalid action status transition: % -> %', old.status, new.status;
    end if;
    -- creator/creation time are immutable once set, regardless of what
    -- an UPDATE payload includes.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  -- completed_at reflects the moment status most recently BECAME
  -- 'completed' — set on the transition in, left untouched while it
  -- stays 'completed' (so re-saving other fields doesn't reset it), and
  -- cleared the moment status moves away from 'completed' (reopening).
  if new.status = 'completed' and (TG_OP = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_actions_before_write on public.actions;
create trigger trg_actions_before_write
  before insert or update on public.actions
  for each row execute function public.actions_before_write();

alter table public.actions enable row level security;

-- Editor-only (owner/collaborator), matching the majority convention
-- already used by quality_gates/commercial_items/handover_documents/
-- weekly_reports/etc. — Actions is a general accountability tool, not
-- snag-specific, so it belongs in that tier rather than the member-level
-- exception snag_items deliberately carves out. This also means it
-- needs no change to can_read_audit_row() (Priority 4) — Actions falls
-- into that function's existing editor-level default bucket exactly.
drop policy if exists "editors read actions" on public.actions;
create policy "editors read actions" on public.actions for select using (public.is_project_editor(project_id));

drop policy if exists "editors insert actions" on public.actions;
create policy "editors insert actions" on public.actions for insert with check (
  public.is_project_editor(project_id)
  and (assigned_to is null or public.is_project_editor_user(project_id, assigned_to))
);

drop policy if exists "editors update actions" on public.actions;
create policy "editors update actions" on public.actions for update using (
  public.is_project_editor(project_id)
) with check (
  public.is_project_editor(project_id)
  and (assigned_to is null or public.is_project_editor_user(project_id, assigned_to))
);

drop policy if exists "editors delete actions" on public.actions;
create policy "editors delete actions" on public.actions for delete using (public.is_project_editor(project_id));

-- Audit integration: write_audit_log()'s existing generic "else" branch
-- (schema.sql v28) already handles any table shaped like this one (a
-- plain project_id column, uuid id) with zero changes — this is the
-- ONLY line needed to bring Actions under the existing audit trail.
drop trigger if exists trg_audit_actions on public.actions;
create trigger trg_audit_actions
  after insert or update or delete on public.actions
  for each row execute function public.write_audit_log();

-- ─── v30 ADDITIONS: Project Control Dashboard ───
--
-- No new tables — the dashboard is built entirely from existing data
-- (actions, hs_audit_items, quality_gates, commercial_items, snag_items)
-- via broad, unfiltered-by-project selects that rely on each table's
-- own existing RLS to scope results, the same "RLS does the real
-- scoping" pattern dashboard.html already used for snag_items before
-- this priority. The one addition below exists purely to avoid an N+1
-- query pattern in the portfolio view.
--
-- get_my_role(project_id) already lets a client learn its own role on
-- ONE project even when it can't read project_members directly
-- (snagging-only members can't — that table is editor-gated). The
-- portfolio dashboard needs this for EVERY visible project at once, to
-- label a snagging-only project honestly ("Snagging Only") instead of
-- fabricating a misleading "0 exceptions" status for data that role was
-- never entitled to see — calling get_my_role() once per project would
-- be exactly the N+1 pattern this priority was told to watch for.
create or replace function public.get_my_project_roles()
returns table(project_id uuid, role text)
language sql
stable
security definer
set search_path = public
as $$
  select project_id, role from public.project_members where user_id = auth.uid();
$$;
grant execute on function public.get_my_project_roles() to authenticated;

-- ─── v31 ADDITIONS: Inspections ───
--
-- A general-purpose, ad-hoc inspection workflow: Inspection -> Finding
-- -> Evidence -> Action -> Owner -> Due Date -> Completion -> Audit
-- Trail. Deliberately separate from hs_audits/hs_audit_items (a
-- specific, fixed-checklist MONTHLY H&S compliance mechanism already
-- feeding monthly_reports — a genuinely different concept, left
-- entirely untouched here, not merged or replaced). Findings that need
-- follow-up link to the EXISTING actions table (Priority 5) — there is
-- no second task system.

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  -- Always trigger-derived from project_id, never trusted from the
  -- client — same principle actions.org_id already uses.
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  inspection_type text not null default 'general' check (inspection_type in ('quality', 'health_safety', 'progress', 'handover', 'general')),
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  inspection_date date not null default current_date,
  -- Free-text name/company, matching hs_audits.conducted_by's own
  -- established naming/shape rather than inventing a parallel field.
  conducted_by text,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inspections_project_status_idx on public.inspections (project_id, status);
create index if not exists inspections_project_date_idx on public.inspections (project_id, inspection_date);

alter table public.inspections enable row level security;

-- Editor-only, matching hs_audits/quality_gates/commercial_items/
-- actions — inspections are management/control data, not the
-- snag_items member-level exception (snagging-only members don't get
-- this module, same as they don't get Actions).
drop policy if exists "editors read inspections" on public.inspections;
create policy "editors read inspections" on public.inspections for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert inspections" on public.inspections;
create policy "editors insert inspections" on public.inspections for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update inspections" on public.inspections;
create policy "editors update inspections" on public.inspections for update using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
drop policy if exists "editors delete inspections" on public.inspections;
create policy "editors delete inspections" on public.inspections for delete using (public.is_project_editor(project_id));

-- Server-side authority for org_id derivation and created_by/created_at
-- immutability — same pattern as actions_before_write().
create or replace function public.inspections_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'inspections.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspections_before_write on public.inspections;
create trigger trg_inspections_before_write
  before insert or update on public.inspections
  for each row execute function public.inspections_before_write();

create table if not exists public.inspection_findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  -- Denormalised onto the finding (not just reachable via inspection_id)
  -- for the same reason hs_audit_items.project_id is denormalised onto
  -- items rather than requiring a join through hs_audits every time —
  -- simpler RLS and query patterns. The trigger below enforces it always
  -- matches the parent inspection's own project_id.
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'action_required', 'resolved', 'accepted', 'cancelled')),
  -- The finding (the origin) references its consequence, not the other
  -- way around — adding an inspection_finding_id column to actions
  -- would couple the deliberately reusable Actions Engine (Priority 5)
  -- to one specific origin module. A finding has at most one action;
  -- nothing here is created automatically — see createActionFromFinding()
  -- in tracker/js/app.js, always an explicit user choice.
  action_id uuid references public.actions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- inspection_id is the primary per-inspection lookup; the other two
-- support project/portfolio-level rollups (open high/critical findings,
-- findings with a linked action) the same way actions' own indexes do.
create index if not exists inspection_findings_inspection_idx on public.inspection_findings (inspection_id);
create index if not exists inspection_findings_project_severity_idx on public.inspection_findings (project_id, severity);
create index if not exists inspection_findings_project_status_idx on public.inspection_findings (project_id, status);
create index if not exists inspection_findings_action_idx on public.inspection_findings (action_id);

alter table public.inspection_findings enable row level security;

drop policy if exists "editors read inspection_findings" on public.inspection_findings;
create policy "editors read inspection_findings" on public.inspection_findings for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert inspection_findings" on public.inspection_findings;
create policy "editors insert inspection_findings" on public.inspection_findings for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update inspection_findings" on public.inspection_findings;
create policy "editors update inspection_findings" on public.inspection_findings for update using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
drop policy if exists "editors delete inspection_findings" on public.inspection_findings;
create policy "editors delete inspection_findings" on public.inspection_findings for delete using (public.is_project_editor(project_id));

-- Validates org_id derivation, created_by/created_at immutability, AND
-- (the important part) that a finding's project_id always matches its
-- own inspection's project_id, and a linked action always belongs to
-- that same project — closing the "attach a finding to another
-- project's inspection" / "link an action across projects" IDOR paths
-- server-side, not merely in the UI.
create or replace function public.inspection_findings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_inspection_project_id uuid;
  v_action_project_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'inspection_findings.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  select project_id into v_inspection_project_id from public.inspections where id = new.inspection_id;
  if v_inspection_project_id is null then
    raise exception 'inspection_findings.inspection_id must reference an existing inspection';
  end if;
  if v_inspection_project_id <> new.project_id then
    raise exception 'a finding''s project_id must match its inspection''s project_id';
  end if;

  if new.action_id is not null then
    select project_id into v_action_project_id from public.actions where id = new.action_id;
    if v_action_project_id is null then
      raise exception 'inspection_findings.action_id must reference an existing action';
    end if;
    if v_action_project_id <> new.project_id then
      raise exception 'a linked action must belong to the same project as the finding';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspection_findings_before_write on public.inspection_findings;
create trigger trg_inspection_findings_before_write
  before insert or update on public.inspection_findings
  for each row execute function public.inspection_findings_before_write();

-- Evidence — a proper relational table (not a jsonb blob) so a finding
-- can carry more than one photo. Storage itself needs no schema
-- change: uploads live at "<project_id>/inspections/..." in the
-- existing site-photos bucket, which site_photos_authorized() (v27)
-- already authorises via is_project_editor() for any area other than
-- "snags" — the exact tier this module needs.
create table if not exists public.inspection_finding_photos (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.inspection_findings(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  photo_url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inspection_finding_photos_finding_idx on public.inspection_finding_photos (finding_id);

alter table public.inspection_finding_photos enable row level security;
drop policy if exists "editors read inspection_finding_photos" on public.inspection_finding_photos;
create policy "editors read inspection_finding_photos" on public.inspection_finding_photos for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert inspection_finding_photos" on public.inspection_finding_photos;
create policy "editors insert inspection_finding_photos" on public.inspection_finding_photos for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors delete inspection_finding_photos" on public.inspection_finding_photos;
create policy "editors delete inspection_finding_photos" on public.inspection_finding_photos for delete using (public.is_project_editor(project_id));
-- No update policy — a photo is replaced by deleting and re-adding, same
-- convention as every other photo attachment in this app.

-- Audit integration: write_audit_log()'s existing generic "else" branch
-- (v28) already handles any plain project_id-shaped table — inspections
-- and inspection_findings both fit it with zero changes to that
-- function. inspection_finding_photos is deliberately NOT audited,
-- matching this schema's existing convention that not every child
-- table is (e.g. hs_audit_items itself isn't audited either) — the
-- audited unit here is the finding's own state, not each evidence
-- upload.
drop trigger if exists trg_audit_inspections on public.inspections;
create trigger trg_audit_inspections
  after insert or update or delete on public.inspections
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_inspection_findings on public.inspection_findings;
create trigger trg_audit_inspection_findings
  after insert or update or delete on public.inspection_findings
  for each row execute function public.write_audit_log();

-- ─── v32 ADDITIONS: Defects / Snagging rationalisation ───
--
-- snag_items already existed (since v1) as a defect record — location,
-- description, trade, photo, a light open/closed/rejected status, and
-- an independent delay flag. It was never a task system and stays one:
-- this adds only the missing accountability layer (owner, due date,
-- verification) plus optional links to the two other control-loop
-- records, without touching its existing meaning, data, or the
-- existing member-level (snagging-only-inclusive) RLS. Every column
-- below is nullable and additive — the 70 real production snag rows at
-- the time of writing get NULL (unassigned/no due date/not verified),
-- which is the correct, non-fabricated reading of data that predates
-- this feature, not an error to correct.
--
-- Deliberately NOT touched: hs_audits/hs_audit_items (a separate,
-- unrelated monthly compliance mechanism), snag_items.status's existing
-- vocabulary (open/closed/rejected — reinterpreting it would risk
-- silently changing the meaning of real historical rows), and the
-- existing member-level RLS on snag_items/snag_items (snagging-only
-- members keep exactly the access they have always had).

alter table public.snag_items add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.snag_items add column if not exists due_date date;
-- The origin (a snag) references its consequence (an action) and, if
-- applicable, its own origin (a finding) — never the reverse, keeping
-- the deliberately reusable Actions Engine (Priority 5) and Inspections
-- (Priority 7) uncoupled from this one module, same principle used for
-- inspection_findings.action_id.
alter table public.snag_items add column if not exists action_id uuid references public.actions(id) on delete set null;
alter table public.snag_items add column if not exists inspection_finding_id uuid references public.inspection_findings(id) on delete set null;
-- Resolved (status = 'closed') is deliberately kept separate from
-- Verified: a contractor/snagging-only member marking a snag closed is
-- not the same as a project editor independently confirming it. Both
-- columns are trigger-managed below — never directly client-trusted.
alter table public.snag_items add column if not exists verified_at timestamptz;
alter table public.snag_items add column if not exists verified_by uuid references auth.users(id) on delete set null;

-- Real query shapes: a project's snag list grouped by status (both the
-- existing per-list views and the new dashboard rollup), overdue/due-
-- soon filtering, and the two new cross-references (Priority 7's own
-- "Inspection Finding -> resulting Snag" navigation, and "does this
-- Action originate from a snag").
create index if not exists snag_items_project_status_idx on public.snag_items (project_id, status);
create index if not exists snag_items_project_due_date_idx on public.snag_items (project_id, due_date);
create index if not exists snag_items_action_idx on public.snag_items (action_id);
create index if not exists snag_items_inspection_finding_idx on public.snag_items (inspection_finding_id);

-- Parameterised twin of is_project_member() — mirrors
-- is_project_editor_user() (Priority 5), but at member level, since a
-- snag's assignee is deliberately NOT restricted to editors: snagging-
-- only members are exactly the people who do the physical fix work and
-- are the most natural assignees for a snag.
create or replace function public.is_project_member_user(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organisation_members om on om.org_id = p.org_id and om.user_id = pm.user_id
    where pm.project_id = p_project_id and pm.user_id = p_user_id
  );
$$;
grant execute on function public.is_project_member_user(uuid, uuid) to authenticated;

-- Server-side authority for the new columns. Existing snag_items RLS
-- (member-level select/insert/update/delete) is completely unchanged —
-- this trigger adds business rules RLS can't express at row level:
-- assignee/action/finding must be legitimate and same-project, and
-- verification specifically requires a project editor, gated on the
-- snag actually being closed, and auto-cleared the moment it's
-- reopened (mirrors actions.completed_at's own set/clear-on-transition
-- pattern from Priority 5).
create or replace function public.snag_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_project_id uuid;
  v_finding_project_id uuid;
  v_client_changed_verification boolean;
  v_reopened boolean;
begin
  if new.assigned_to is not null and not public.is_project_member_user(new.project_id, new.assigned_to) then
    raise exception 'assigned_to must be a member of this project';
  end if;

  if new.action_id is not null then
    select project_id into v_action_project_id from public.actions where id = new.action_id;
    if v_action_project_id is null then
      raise exception 'snag_items.action_id must reference an existing action';
    end if;
    if v_action_project_id <> new.project_id then
      raise exception 'a linked action must belong to the same project as the snag';
    end if;
  end if;

  if new.inspection_finding_id is not null then
    select project_id into v_finding_project_id from public.inspection_findings where id = new.inspection_finding_id;
    if v_finding_project_id is null then
      raise exception 'snag_items.inspection_finding_id must reference an existing inspection finding';
    end if;
    if v_finding_project_id <> new.project_id then
      raise exception 'a linked inspection finding must belong to the same project as the snag';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    -- A snag can never be created pre-verified, or pre-closed with a
    -- backdated closed_date — both are always derived from a real
    -- status transition, never trusted from the client.
    new.verified_at := null;
    new.verified_by := null;
    new.closed_date := case when new.status = 'closed' then coalesce(new.closed_date, current_date) else null end;
    return new;
  end if;

  -- UPDATE: capture whether the CLIENT itself is trying to change
  -- verification, and whether this write is a genuine reopen (closed ->
  -- not closed), BEFORE any auto-management below runs. A reopen auto-
  -- clears a stale verification as a side effect and must not be
  -- blocked by the editor-only check that guards a DELIBERATE
  -- verification change — but it must also not silently swallow a
  -- client's attempt to verify a snag that was never closed to begin
  -- with, which needs its own real error below.
  v_client_changed_verification := new.verified_at is distinct from old.verified_at;
  v_reopened := old.status = 'closed' and new.status <> 'closed';

  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_date := coalesce(new.closed_date, current_date);
  elsif new.status <> 'closed' then
    new.closed_date := null;
  end if;

  if v_reopened then
    new.verified_at := null;
    new.verified_by := null;
  elsif v_client_changed_verification then
    if not public.is_project_editor(new.project_id) then
      raise exception 'only a project editor (owner or collaborator) can change a snag''s verification';
    end if;
    if new.verified_at is not null then
      if new.status <> 'closed' then
        raise exception 'a snag must be closed before it can be verified';
      end if;
      new.verified_at := now();
      new.verified_by := auth.uid();
    else
      new.verified_by := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_snag_items_before_write on public.snag_items;
create trigger trg_snag_items_before_write
  before insert or update on public.snag_items
  for each row execute function public.snag_items_before_write();

-- Audit integration: snag_items has been audited since Priority 4
-- (trg_audit_snag_items, already wired to the existing generic
-- write_audit_log()) — every new column above is captured automatically
-- by that same trigger with ZERO changes needed to it or to
-- can_read_audit_row() (snag_items already sits in that function's
-- member-level bucket, matching its own RLS exactly).

-- ─── v33 ADDITIONS: Weekly Reporting (system position + lifecycle) ───
--
-- weekly_reports already existed as a rich, free-text/jsonb Clerk of
-- Works record (progress, weather, labour, risks, commercial items,
-- photos...) — that stays exactly what it is; the human side of the
-- report needed no new fields. What was missing was (a) any lifecycle
-- at all (every report was permanently a bare, unstatused row) and (b)
-- somewhere to hold the SYSTEM-DERIVED weekly position (exceptions,
-- what changed) as a real, reviewable, eventually-frozen part of the
-- report rather than a purely live recomputation with nowhere to land.
--
-- Lifecycle: draft -> reviewed -> approved -> issued, one step forward
-- at a time, with "back to draft" (Revise) as the one deliberate
-- reopening path from any later stage — mirrors actions' own
-- completed->open reopen path. Once a report is approved or issued its
-- content (system_position included) is locked: the trigger below
-- rejects any update that changes content while staying in, or moving
-- into, one of those two statuses. A report can only be edited again by
-- first Revising it back to draft, an explicit, visible action, not a
-- side effect of an ordinary save.
alter table public.weekly_reports add column if not exists status text not null default 'draft' check (status in ('draft', 'reviewed', 'approved', 'issued'));
-- The frozen system-generated position — exceptions, activity, and
-- per-module summaries computed by getWeeklyReportPosition() (see
-- tracker/js/app.js) and written back into the report on save while
-- still draft/reviewed. Never touched directly by any UI input; the
-- ONLY thing that can change it is a fresh call to that same function.
alter table public.weekly_reports add column if not exists system_position jsonb not null default '{}'::jsonb;
alter table public.weekly_reports add column if not exists position_generated_at timestamptz;
alter table public.weekly_reports add column if not exists updated_at timestamptz not null default now();

create index if not exists weekly_reports_project_week_idx on public.weekly_reports (project_id, week_starting);
create index if not exists weekly_reports_project_status_idx on public.weekly_reports (project_id, status);

create or replace function public.valid_weekly_report_status_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_from, p_to) in (
    ('draft', 'reviewed'),
    ('reviewed', 'approved'),
    ('approved', 'issued'),
    ('reviewed', 'draft'),
    ('approved', 'draft'),
    ('issued', 'draft')
  );
$$;

-- Server-side authority for created_by/created_at immutability,
-- updated_at, status-transition validity, and — the part that actually
-- matters — refusing to let ANY content field change while the report
-- is (or is moving into) 'approved'/'issued'. Compares the whole row as
-- jsonb, excluding only the two columns a locked report is still
-- allowed to carry (status itself, and the updated_at stamp that comes
-- with any write) — new columns added to weekly_reports later are
-- automatically covered by this comparison with no trigger change
-- needed, same dynamic-jsonb approach write_audit_log() already uses.
create or replace function public.weekly_reports_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.status := 'draft'; -- a report can never be created pre-approved/issued
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status <> old.status and not public.valid_weekly_report_status_transition(old.status, new.status) then
    raise exception 'Invalid weekly report status transition: % -> %', old.status, new.status;
  end if;

  if new.status in ('approved', 'issued') then
    if (to_jsonb(new) - array['status', 'updated_at']::text[]) is distinct from (to_jsonb(old) - array['status', 'updated_at']::text[]) then
      raise exception 'This report is % — its content is locked. Use Revise to reopen it as a draft before editing.', new.status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_weekly_reports_before_write on public.weekly_reports;
create trigger trg_weekly_reports_before_write
  before insert or update on public.weekly_reports
  for each row execute function public.weekly_reports_before_write();

-- Audit integration: weekly_reports has been audited since Priority 4
-- (trg_audit_weekly_reports) and already sits in can_read_audit_row()'s
-- default editor-level bucket, matching its own RLS exactly — zero
-- changes needed. Every status transition (and any rejected write) is
-- captured automatically.

-- Inspection Findings: a reliable "when did this actually get resolved"
-- timestamp, needed so the weekly report can say "findings resolved
-- this period" precisely rather than approximating it from updated_at
-- (which any edit touches, not just a resolution). Mirrors
-- actions.completed_at's own convention exactly: server-derived only,
-- set the moment status transitions INTO 'resolved', cleared the
-- moment it moves away (a finding can be freely reopened, same as a
-- snag or an action).
alter table public.inspection_findings add column if not exists resolved_at timestamptz;

create or replace function public.inspection_findings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_inspection_project_id uuid;
  v_action_project_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'inspection_findings.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  select project_id into v_inspection_project_id from public.inspections where id = new.inspection_id;
  if v_inspection_project_id is null then
    raise exception 'inspection_findings.inspection_id must reference an existing inspection';
  end if;
  if v_inspection_project_id <> new.project_id then
    raise exception 'a finding''s project_id must match its inspection''s project_id';
  end if;

  if new.action_id is not null then
    select project_id into v_action_project_id from public.actions where id = new.action_id;
    if v_action_project_id is null then
      raise exception 'inspection_findings.action_id must reference an existing action';
    end if;
    if v_action_project_id <> new.project_id then
      raise exception 'a linked action must belong to the same project as the finding';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.resolved_at := case when new.status = 'resolved' then now() else null end;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspection_findings_before_write on public.inspection_findings;
create trigger trg_inspection_findings_before_write
  before insert or update on public.inspection_findings
  for each row execute function public.inspection_findings_before_write();

-- ─── v34 ADDITIONS: Document Management foundation ─────────────────
--
-- Organisation -> Project -> Document -> Revision -> File. A controlled
-- document (drawing, specification, or a general "other" project
-- record) is a title/type/number/status shell whose actual content is
-- a sequence of IMMUTABLE revisions — never a mutable file_url on the
-- document itself, unlike every ad-hoc file field elsewhere in this
-- schema (snag_items.photo_url, handover_documents.file_url, ...),
-- which stay exactly as they are; this is a genuinely new concept, not
-- a replacement for them. See tracker/README.md for the full design
-- rationale (why this table is justified, why Handover/evidence are
-- deliberately NOT migrated into it, and the private-bucket decision
-- below).
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_type text not null default 'other' check (document_type in ('drawing', 'specification', 'other')),
  title text not null,
  doc_number text,
  status text not null default 'current' check (status in ('draft', 'current', 'superseded', 'archived')),
  -- Deliberately NOT given a FK constraint yet — added once
  -- document_revisions exists below (documents and document_revisions
  -- reference each other, so the FK is added after both tables exist).
  -- Never client-settable — see documents_before_write() below; the
  -- only way this ever changes is the internal promotion inside
  -- document_revisions_after_insert().
  current_revision_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Denormalised from documents.project_id (trigger-enforced below) —
  -- same reasoning as inspection_findings.project_id: simpler RLS, and
  -- required for this table to fall into write_audit_log()'s existing
  -- generic project_id-based branch with zero code changes.
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_number integer not null,
  -- Which bucket this revision's file actually lives in. Every NEW
  -- revision uploaded through this feature goes into the private
  -- 'controlled-documents' bucket (file_url below holds the raw
  -- object PATH for these — never directly usable, always resolved via
  -- a signed URL or storage.download() at read time). Migrated legacy
  -- Drawings/Specifications rows (see the backfill below) keep
  -- pointing at their real, already-public 'site-photos' object
  -- instead of being silently re-hosted — file_url for THOSE rows is
  -- the full public URL, exactly as drawings.drawing_url always was.
  storage_bucket text not null default 'controlled-documents' check (storage_bucket in ('controlled-documents', 'site-photos')),
  file_url text not null,
  file_name text not null,
  file_size bigint,
  mime_type text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  -- Set once, automatically, the moment a LATER revision is uploaded —
  -- never client-settable, never cleared once set (a superseded
  -- revision stays superseded forever; there is no "reopen an old
  -- revision" concept, unlike a snag or a finding). Null means this
  -- revision has never been superseded — it may or may not currently
  -- be the document's current_revision_id (e.g. the document could
  -- have since been archived without a newer revision existing).
  superseded_at timestamptz,
  unique (document_id, revision_number)
);

alter table public.documents drop constraint if exists documents_current_revision_id_fkey;
alter table public.documents add constraint documents_current_revision_id_fkey
  foreign key (current_revision_id) references public.document_revisions(id) on delete set null;

create index if not exists documents_org_idx on public.documents (org_id);
create index if not exists documents_project_status_idx on public.documents (project_id, status);
create index if not exists documents_project_type_idx on public.documents (project_id, document_type);
create index if not exists document_revisions_document_revision_idx on public.document_revisions (document_id, revision_number);
create index if not exists document_revisions_project_idx on public.document_revisions (project_id);

alter table public.documents enable row level security;
-- Read is member-level (snagging-only included) — mirrors drawings'
-- own established SELECT rule exactly, since "drawing" is one of this
-- table's document_types and a snagging-only member has always been
-- able to read drawings (they need them to pin snags). Write is
-- editor-only throughout, same as every other controlled/management
-- table in this schema — a snagging-only member gets read access to
-- documents, never the ability to create one or upload a revision.
drop policy if exists "members read documents" on public.documents;
create policy "members read documents" on public.documents for select using (public.is_project_member(project_id));
drop policy if exists "editors insert documents" on public.documents;
create policy "editors insert documents" on public.documents for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update documents" on public.documents;
create policy "editors update documents" on public.documents for update using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
-- Deliberately NO delete policy — conservative by design (see brief
-- section 18). Retiring a document is done via status = 'archived',
-- never a DELETE; this also means no document (and none of its
-- revisions) can ever be deleted through the app, closing off an
-- entire class of storage-orphan risk this table would otherwise add.

alter table public.document_revisions enable row level security;
drop policy if exists "members read document_revisions" on public.document_revisions;
create policy "members read document_revisions" on public.document_revisions for select using (public.is_project_member(project_id));
drop policy if exists "editors insert document_revisions" on public.document_revisions;
create policy "editors insert document_revisions" on public.document_revisions for insert with check (public.is_project_editor(project_id));
-- Deliberately NO update, NO delete policy for any client — revisions
-- are immutable from the moment they're created. RLS enabled + zero
-- policies for those operations means Postgres default-denies them to
-- every role except a security-definer function that bypasses RLS
-- (the same "enabled, unpolicied = denied" idiom audit_log already
-- uses) — the only way superseded_at is ever set is the internal
-- promotion inside document_revisions_after_insert() below.

-- Server-side authority for documents: org_id derivation (never
-- client-trusted), created_by/created_at immutability, updated_at, and
-- — the one genuinely load-bearing rule — current_revision_id can
-- NEVER be changed by an ordinary client UPDATE, only by the internal
-- promotion below. A session-local flag (set only inside that internal
-- promotion, for the exact duration of its own UPDATE statement) is
-- the one narrow exception; anything else always gets current_revision_id
-- silently reset back to its existing value, the same "force back to
-- OLD" idiom created_by/created_at already use throughout this schema.
create or replace function public.documents_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'documents.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.current_revision_id := null; -- always starts empty; set by the first revision's own insert
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if coalesce(current_setting('app.allow_current_revision_change', true), '') <> 'on' then
    new.current_revision_id := old.current_revision_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_documents_before_write on public.documents;
create trigger trg_documents_before_write
  before insert or update on public.documents
  for each row execute function public.documents_before_write();

-- Server-side authority for document_revisions: derives project_id
-- from the parent document (never client-trusted, and closes the
-- "attach a revision to a document in another project" IDOR the same
-- way Priority 7/8 closed the equivalent for findings/snags), and —
-- the part that actually protects integrity — computes revision_number
-- itself (MAX+1 for this document, same established pattern
-- set_snag_item_no() already uses), never trusting whatever the client
-- sends. The unique(document_id, revision_number) constraint is the
-- real backstop against a genuine concurrent-upload race, exactly the
-- same residual risk set_snag_item_no() has always had and accepted.
create or replace function public.document_revisions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_project_id uuid;
  v_next_revision integer;
begin
  select project_id into v_document_project_id from public.documents where id = new.document_id;
  if v_document_project_id is null then
    raise exception 'document_revisions.document_id must reference an existing document';
  end if;
  new.project_id := v_document_project_id;

  select coalesce(max(revision_number), 0) + 1 into v_next_revision
  from public.document_revisions where document_id = new.document_id;
  new.revision_number := v_next_revision;

  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  new.superseded_at := null;

  return new;
end;
$$;

drop trigger if exists trg_document_revisions_before_insert on public.document_revisions;
create trigger trg_document_revisions_before_insert
  before insert on public.document_revisions
  for each row execute function public.document_revisions_before_insert();

-- The actual promotion: whatever revision was previously current gets
-- superseded_at stamped (once — "and superseded_at is null" makes this
-- safe to reason about even though in practice a revision can only
-- ever be the target of this exactly once), then the document's
-- current_revision_id is repointed at the brand-new row. Runs as
-- security definer so both writes bypass RLS the same way
-- write_audit_log() already does for audit_log — this is the ONLY
-- code path in the whole application that ever changes
-- document_revisions.superseded_at or documents.current_revision_id.
create or replace function public.document_revisions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_current_id uuid;
begin
  select current_revision_id into v_old_current_id from public.documents where id = new.document_id;

  if v_old_current_id is not null and v_old_current_id <> new.id then
    update public.document_revisions set superseded_at = now() where id = v_old_current_id and superseded_at is null;
  end if;

  perform set_config('app.allow_current_revision_change', 'on', true);
  update public.documents set current_revision_id = new.id where id = new.document_id;
  perform set_config('app.allow_current_revision_change', 'off', true);

  return new;
end;
$$;

drop trigger if exists trg_document_revisions_after_insert on public.document_revisions;
create trigger trg_document_revisions_after_insert
  after insert on public.document_revisions
  for each row execute function public.document_revisions_after_insert();

-- Audit integration: reuses the existing generic write_audit_log() —
-- both tables have a plain id + project_id, so they fall straight into
-- its default branch with zero code changes. documents/document_revisions
-- are added to can_read_audit_row()'s member-level bucket (alongside
-- projects/snag_items) to match their own real SELECT RLS above —
-- editor-level (the function's default) would incorrectly hide
-- document history from a snagging-only member who CAN read the
-- documents themselves.
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

  if p_project_id is null then
    return false;
  end if;

  if p_table_name in ('projects', 'snag_items', 'documents', 'document_revisions') then
    return public.is_project_member(p_project_id);
  end if;

  return public.is_project_editor(p_project_id);
end;
$$;

drop trigger if exists trg_audit_documents on public.documents;
create trigger trg_audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_document_revisions on public.document_revisions;
create trigger trg_audit_document_revisions
  after insert or update or delete on public.document_revisions
  for each row execute function public.write_audit_log();

-- ─── Storage: a SEPARATE, PRIVATE bucket for controlled documents ───
-- 'site-photos' (public-by-obscurity, unauthenticated read) is correct
-- and unchanged for every operational-evidence use it already serves
-- (snag/inspection/H&S/report photos) — those stay exactly as they
-- are. A controlled Document (a drawing, a spec, a RAMS document) is a
-- different trust class: genuinely private storage, authenticated
-- access only, is the right default, and a brand-new bucket is the
-- cleanest way to get there without touching the working, already-
-- tested public bucket at all. New revisions store their object PATH
-- (not a public URL) in document_revisions.file_url and are resolved
-- via a signed URL / storage.download() at read time — see
-- getDocumentFileUrl() in tracker/js/app.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'controlled-documents', 'controlled-documents', false,
  52428800, -- 50MB, matching site-photos' own established limit
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do nothing;

-- Every object's own first path segment is the project_id it belongs
-- to — the same server-side, path-derived authorization principle
-- site_photos_path_parts()/site_photos_authorized() already established,
-- just for this bucket's simpler (always project-scoped, no org-logo-
-- style exception) path shape.
create or replace function public.controlled_documents_path_project(object_name text)
returns uuid
language plpgsql immutable
as $$
declare
  candidate text := (storage.foldername(object_name))[1];
begin
  if candidate is null or candidate !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return candidate::uuid;
end;
$$;

create or replace function public.controlled_documents_read_authorized(object_name text)
returns boolean
language sql stable
as $$
  select public.is_project_member(public.controlled_documents_path_project(object_name));
$$;

create or replace function public.controlled_documents_write_authorized(object_name text)
returns boolean
language sql stable
as $$
  select public.is_project_editor(public.controlled_documents_path_project(object_name));
$$;

grant execute on function public.controlled_documents_path_project(text) to authenticated;
grant execute on function public.controlled_documents_read_authorized(text) to authenticated;
grant execute on function public.controlled_documents_write_authorized(text) to authenticated;

drop policy if exists "project members read controlled-documents" on storage.objects;
create policy "project members read controlled-documents" on storage.objects
  for select using (bucket_id = 'controlled-documents' and public.controlled_documents_read_authorized(name));

drop policy if exists "project editors upload controlled-documents" on storage.objects;
create policy "project editors upload controlled-documents" on storage.objects
  for insert with check (bucket_id = 'controlled-documents' and public.controlled_documents_write_authorized(name));

-- No update, no delete policy — every upload writes a fresh random
-- object name (never upsert), and revisions/their files are never
-- deleted once created, matching documents/document_revisions' own
-- "no delete policy" decision above.

-- ─── Migrate existing Drawings / Specifications into Documents ──────
-- drawings/specifications are NOT dropped, NOT emptied, and remain
-- fully functional exactly as they are today — this is an additive
-- backfill, not a cutover. Reason: drawings.id is load-bearing for the
-- existing pinpoint-snagging feature (snag_items.drawing_id,
-- quality_gates.drawing_id, drawing-view.html's whole pin UI) — moving
-- or deleting it would break real, working functionality this priority
-- was explicitly told not to touch. Going forward, NEW documents
-- (drawings, specifications, or anything else) are created through the
-- new Documents UI; the old Drawings/Specifications pages keep working
-- for pinning exactly as before. Idempotent: matches each legacy row
-- to a document by (project_id, document_type, title) and skips it if
-- a document already exists for it, so re-running this file never
-- creates duplicates.
do $$
declare
  d record;
  v_doc_id uuid;
begin
  for d in select * from public.drawings loop
    select id into v_doc_id from public.documents
      where project_id = d.project_id and document_type = 'drawing' and title = d.drawing_name
      limit 1;
    if v_doc_id is null then
      insert into public.documents (org_id, project_id, document_type, title, doc_number, status, created_by, created_at, updated_at)
      values (
        (select org_id from public.projects where id = d.project_id),
        d.project_id, 'drawing', d.drawing_name, d.plot_number, 'current', d.created_by, d.created_at, d.created_at
      )
      returning id into v_doc_id;

      insert into public.document_revisions (document_id, project_id, revision_number, storage_bucket, file_url, file_name, uploaded_by, uploaded_at)
      values (v_doc_id, d.project_id, 1, 'site-photos', d.drawing_url, split_part(d.drawing_url, '/', -1), d.created_by, d.created_at);

      update public.documents set current_revision_id = (
        select id from public.document_revisions where document_id = v_doc_id and revision_number = 1
      ) where id = v_doc_id;
    end if;
  end loop;

  for d in select * from public.specifications loop
    select id into v_doc_id from public.documents
      where project_id = d.project_id and document_type = 'specification' and title = d.spec_name
      limit 1;
    if v_doc_id is null then
      insert into public.documents (org_id, project_id, document_type, title, status, created_by, created_at, updated_at)
      values (
        (select org_id from public.projects where id = d.project_id),
        d.project_id, 'specification', d.spec_name, 'current', d.created_by, d.created_at, d.created_at
      )
      returning id into v_doc_id;

      insert into public.document_revisions (document_id, project_id, revision_number, storage_bucket, file_url, file_name, uploaded_by, uploaded_at)
      values (v_doc_id, d.project_id, 1, 'site-photos', d.spec_url, split_part(d.spec_url, '/', -1), d.created_by, d.created_at);

      update public.documents set current_revision_id = (
        select id from public.document_revisions where document_id = v_doc_id and revision_number = 1
      ) where id = v_doc_id;
    end if;
  end loop;
end;
$$;

-- ─── v35 ADDITIONS: Programme Control foundation (Phase 2) ──────────
--
-- Project -> Programme -> Programme Activity. A deliberately minimal
-- foundation — see tracker/README.md for the full Phase 1 inspection
-- and Phase 2 design rationale (why each field was kept/dropped from
-- the original proposal, the import-identity strategy, and why no
-- Gantt/dependency/critical-path/versioning engine exists yet).
--
-- Hybrid architecture: an external tool (MS Project / Asta / Excel)
-- remains the actual planning tool. This schema only imports/records
-- planned dates, then owns forecast/actual/status/progress — it is
-- NOT a scheduling engine and deliberately has no dependency graph.
create table if not exists public.programmes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default 'Programme',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "One active programme per project" is enforced here, not in a
-- trigger — a partial unique index is simpler, always correct under
-- concurrent writes (the same guarantee unique(document_id,
-- revision_number) gives document_revisions), and needs no extra
-- code. draft/archived programmes are deliberately NOT constrained
-- this way — a project may accumulate several archived programmes
-- over time (a genuine historical record), and nothing stops more
-- than one draft existing while it's still being set up.
create unique index if not exists programmes_one_active_per_project on public.programmes (project_id) where (status = 'active');

create index if not exists programmes_project_idx on public.programmes (project_id);
-- Bare org_id index purely to avoid this being flagged as an
-- unindexed foreign key by Supabase's advisor — matches every other
-- org-scoped child table's own convention (actions_org_id_idx etc.);
-- real query volume here doesn't need it (a project typically has 0-2
-- programme rows), it's just consistency + advisor hygiene.
create index if not exists programmes_org_idx on public.programmes (org_id);
-- No status index — not justified at this cardinality (see above).

alter table public.programmes enable row level security;
-- Editor-only throughout, per the brief: "Programme data should
-- initially be editor-only. Do not widen access to snagging-only
-- users yet." Matches actions/inspections/hs_audits' own tier exactly
-- — not documents/snag_items' member-level read exception.
drop policy if exists "editors read programmes" on public.programmes;
create policy "editors read programmes" on public.programmes for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert programmes" on public.programmes;
create policy "editors insert programmes" on public.programmes for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update programmes" on public.programmes;
create policy "editors update programmes" on public.programmes for update using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
-- Deliberately NO delete policy — a programme is retired via
-- status='archived' (that's the entire purpose of the status field),
-- never removed outright, so its activities' history is never lost
-- to a stray DELETE.

-- Server-side authority: org_id derivation (never client-trusted,
-- same principle actions_before_write()/documents_before_write()
-- already use), created_by/created_at immutability, updated_at.
-- Status is deliberately left free to move between draft/active/
-- archived in any direction by an editor — a 3-state field with only
-- the one-active-per-project rule above to enforce doesn't need a
-- transition-restriction engine on top (unlike weekly_reports'
-- genuinely sequential Draft->Reviewed->Approved->Issued lifecycle,
-- which this brief did not ask for here).
create or replace function public.programmes_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'programmes.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_programmes_before_write on public.programmes;
create trigger trg_programmes_before_write
  before insert or update on public.programmes
  for each row execute function public.programmes_before_write();

-- ─── Programme Activities ────────────────────────────────────────
--
-- Deviations from the Phase 1 field list (see tracker/README.md for
-- the full reasoning behind each):
--   - activity_type DROPPED: would have been a second, competing way
--     to say "is this a milestone" alongside is_milestone, or else an
--     unconstrained free label duplicating what title already says —
--     either way, a field with no real behaviour behind it. Nothing
--     currently reads or writes it, so it was cut rather than shipped
--     as decoration.
--   - sort_order DROPPED: only meaningful once a drag-reorder or
--     fixed-sequence UI exists (this phase's list view sorts by real
--     dates instead), unlike quality_gates/internal_milestones' own
--     sort_order, which orders a genuinely FIXED, auto-seeded list.
--   - responsible_party (free text) REPLACED with assigned_to (uuid
--     references auth.users) — see the column comment below.
--   - external_id ADDED (not in the Phase 1 list) — required by this
--     phase's own brief (§12): a future re-import must be able to
--     tell "is this the same activity I imported last week", and
--     title alone is not a safe key (titles get renamed, duplicated).
create table if not exists public.programme_activities (
  id uuid primary key default gen_random_uuid(),
  -- Denormalised from programmes.project_id (trigger-enforced, never
  -- client-trusted) — same reasoning document_revisions.project_id
  -- already established: simpler RLS, and required for this table to
  -- fall into write_audit_log()'s existing generic project_id-based
  -- branch with zero code changes.
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  programme_id uuid not null references public.programmes(id) on delete cascade,
  -- Nullable by design (brief §7) — an activity may be site-wide,
  -- block-wide, or otherwise not tied to one plot. Validated
  -- server-side to belong to the SAME project as the activity itself
  -- (see programme_activities_before_write() below) — never trusted
  -- from the client, the same IDOR class already closed for
  -- inspection_findings.action_id / snag_items.drawing_id.
  plot_id uuid references public.plots(id) on delete set null,
  title text not null,
  -- A stable key for a future importer to recognise "this is the same
  -- activity as last time", not this phase's UI. Unique per programme
  -- when present; null when the source programme has no ID of its
  -- own (see tracker/README.md's import-identity fallback strategy —
  -- matching on programme_id+plot_id+title is the documented fallback,
  -- not implemented as code this phase since no importer exists yet).
  external_id text,
  is_milestone boolean not null default false,
  planned_start date,
  planned_finish date,
  -- Defaults to the planned dates on creation (trigger, see below) so
  -- a freshly-created/imported activity always has a sane forecast
  -- rather than an ambiguous null — never overwritten on a later
  -- update, only defaulted once at insert time.
  forecast_start date,
  forecast_finish date,
  actual_start date,
  actual_finish date,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete', 'cancelled')),
  percent_complete numeric not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  -- Who is actually responsible for getting this done — deliberately
  -- a real project member (references auth.users, validated against
  -- is_project_member_user() below), not free text. This mirrors
  -- actions.assigned_to/snag_items.assigned_to exactly rather than
  -- inventing a parallel identity model, per the brief's own
  -- instruction to prefer a relational reference where the existing
  -- architecture already supports it cleanly. Deliberately validated
  -- at MEMBER level, not editor level (unlike actions.assigned_to) —
  -- the person responsible for doing site work is very often a
  -- snagging-only main-contractor contact who has no reason to be
  -- able to edit the programme itself, the same distinction
  -- snag_items.assigned_to already draws.
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_start is null or planned_finish is null or planned_finish >= planned_start),
  check (forecast_start is null or forecast_finish is null or forecast_finish >= forecast_start),
  check (actual_start is null or actual_finish is null or actual_finish >= actual_start)
);

create unique index if not exists programme_activities_external_id_uidx on public.programme_activities (programme_id, external_id) where (external_id is not null);

-- Indexes tied to real query shapes only (brief §11 — "explain each
-- index added", "do not blindly add every possible index"):
--   - (project_id, status): a project's activity list, optionally
--     filtered by status — the main query this phase's list page runs.
--   - (project_id, forecast_finish): "what's coming up / overdue" —
--     the natural default sort for the list page, and the query a
--     future dashboard exception check will run most.
--   - (programme_id): "every activity in this programme" (archiving a
--     programme, or a future re-import scoped to it).
--   - org_id: advisor-hygiene convention, same as programmes_org_idx.
-- Deliberately OMITTED: a planned_start index (the brief listed it as
-- a candidate, but nothing this phase sorts/filters by start date
-- alone — planned_finish/forecast_finish answer "when is this due",
-- which is the actual question this phase's UI and future dashboard
-- ask) and a plot_id index (no query in this phase looks up
-- activities by plot — trivial to add once a plot-detail integration
-- exists to justify it).
create index if not exists programme_activities_project_status_idx on public.programme_activities (project_id, status);
create index if not exists programme_activities_project_forecast_finish_idx on public.programme_activities (project_id, forecast_finish);
create index if not exists programme_activities_programme_idx on public.programme_activities (programme_id);
create index if not exists programme_activities_org_idx on public.programme_activities (org_id);

alter table public.programme_activities enable row level security;
drop policy if exists "editors read programme_activities" on public.programme_activities;
create policy "editors read programme_activities" on public.programme_activities for select using (public.is_project_editor(project_id));
drop policy if exists "editors insert programme_activities" on public.programme_activities;
create policy "editors insert programme_activities" on public.programme_activities for insert with check (public.is_project_editor(project_id));
drop policy if exists "editors update programme_activities" on public.programme_activities;
create policy "editors update programme_activities" on public.programme_activities for update using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
-- Unlike documents/document_revisions, activities ARE deletable by an
-- editor (brief §17 explicitly allows "delete/archive" in the UI) —
-- there is no revision-history concept here to protect, and removing
-- a wrongly-imported or duplicate row is normal, expected editing.
drop policy if exists "editors delete programme_activities" on public.programme_activities;
create policy "editors delete programme_activities" on public.programme_activities for delete using (public.is_project_editor(project_id));

-- Server-side authority: derives org_id/project_id from the parent
-- programme (never client-trusted — closes the same "attach a row to
-- a programme in another project" IDOR class Priority 7/8/10 already
-- closed for findings/snags/revisions), validates plot_id belongs to
-- that SAME derived project (closing the equivalent IDOR for a
-- cross-project plot_id), validates assigned_to is a real member of
-- the project, forces created_by/created_at immutability, defaults
-- forecast dates from planned dates on insert, and keeps
-- percent_complete honest at the two ends of the status scale.
--
-- Deliberately NOT a transition-restriction trigger (unlike
-- actions_before_write()'s valid_action_status_transition() check) —
-- programme activities are frequently bulk-imported or corrected with
-- an arbitrary starting status (a mostly-finished programme imported
-- retroactively, or a reopened "complete" activity after a defect is
-- found), and restricting that would actively hinder legitimate
-- import/correction use cases this table exists to support.
create or replace function public.programme_activities_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_plot_project_id uuid;
begin
  select project_id, org_id into v_project_id, v_org_id from public.programmes where id = new.programme_id;
  if v_project_id is null then
    raise exception 'programme_activities.programme_id must reference an existing programme';
  end if;
  new.project_id := v_project_id;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'programme_activities.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the programme activity';
    end if;
  end if;

  if new.assigned_to is not null and not public.is_project_member_user(new.project_id, new.assigned_to) then
    raise exception 'assigned_to must be a member of this project';
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    if new.forecast_start is null then new.forecast_start := new.planned_start; end if;
    if new.forecast_finish is null then new.forecast_finish := new.planned_finish; end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  -- "complete should require appropriate completion state": force
  -- percent_complete to 100 on transition into complete (never trust
  -- a lower client-supplied value), and stamp actual_finish once, on
  -- the transition, only if the client didn't already supply a real
  -- date — never force-overwritten on every subsequent save the way
  -- actions.completed_at is, since actual_finish is a real-world
  -- construction date a user may need to correct afterwards while
  -- status stays 'complete'.
  if new.status = 'complete' then
    new.percent_complete := 100;
    if TG_OP = 'INSERT' or old.status <> 'complete' then
      if new.actual_finish is null then
        new.actual_finish := current_date;
      end if;
    end if;
  elsif new.status = 'not_started' then
    new.percent_complete := 0;
  end if;
  -- Reopening a previously-complete activity (status moving away from
  -- 'complete') deliberately leaves actual_finish untouched — it
  -- remains a true historical record of when the work was actually
  -- finished, even if the row is reopened later for correction. This
  -- is the one deliberate divergence from actions.completed_at, which
  -- always clears on reopen; construction reality (a real date the
  -- work stopped) doesn't become untrue just because the record is
  -- reopened.

  return new;
end;
$$;

drop trigger if exists trg_programme_activities_before_write on public.programme_activities;
create trigger trg_programme_activities_before_write
  before insert or update on public.programme_activities
  for each row execute function public.programme_activities_before_write();

-- Audit integration: reuses the existing generic write_audit_log() —
-- both tables have a plain id + project_id, so they fall straight
-- into its default branch with zero code changes. Read access to
-- their audit rows needs zero changes to can_read_audit_row() either
-- — its existing default (editor-level) branch already matches these
-- tables' own editor-only SELECT RLS above, unlike documents/
-- document_revisions in Priority 10, which needed adding to its
-- member-level bucket.
drop trigger if exists trg_audit_programmes on public.programmes;
create trigger trg_audit_programmes
  after insert or update or delete on public.programmes
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_programme_activities on public.programme_activities;
create trigger trg_audit_programme_activities
  after insert or update or delete on public.programme_activities
  for each row execute function public.write_audit_log();

-- ─── v36 ADDITIONS: Controlled XLSX Programme Import (Phase 3) ──────
--
-- Adds ONE new security-definer RPC — import_programme_activities() —
-- the confirmed-import transaction the Phase 3 brief asked for, plus a
-- trivial, additive widening of documents.document_type to optionally
-- retain the raw uploaded workbook through the existing Priority 10
-- Documents architecture (no new storage, no new document system).
--
-- What this migration deliberately does NOT add: any new table. The
-- entire reconciliation/matching/validation contract (external_id
-- identity, plot+title fallback, import-owned vs. app-owned fields)
-- already exists from Phase 2 (v35) and needed no schema change to
-- reuse here — this RPC is the server-side, re-validated enforcement
-- of that same contract, not a new one.

-- Every worksheet cell the client parses arrives here as plain jsonb
-- — no trust is placed in client-side validation having actually run.
-- Re-derives project_id/org_id from the programme (never client-
-- trusted), re-checks editor authorization explicitly (this function
-- is security definer, so its own internal writes bypass
-- programme_activities' table RLS — this check IS the real boundary,
-- the same reasoning documents_before_write()/actions_before_write()
-- already rely on for their own internal writes), re-validates
-- plot_id belongs to the same project (IDOR), re-detects duplicate
-- external_ids WITHIN the payload and ambiguous (plot,title) fallback
-- matches SERVER-SIDE (never trusts the client's own pre-check alone,
-- since the real database state may have changed since the preview
-- was generated), and only ever writes PROGRAMME_IMPORT_OWNED_FIELDS
-- (title/planned dates/is_milestone/external_id/plot_id) — it has no
-- knowledge of forecast/actual/status/percent_complete/assigned_to at
-- all, so there is no code path by which it could touch them, not
-- merely a convention it happens to follow.
--
-- Row-level problems (missing title, duplicate external_id in this
-- batch, an ambiguous fallback match, a cross-project plot_id) are
-- collected and that row is skipped — they are expected, anticipated
-- outcomes of importing real-world data, not failures of the
-- operation itself. A genuinely UNEXPECTED error (anything not
-- explicitly anticipated above) is left to propagate and roll back
-- the ENTIRE function's transaction — plpgsql's normal behaviour for
-- an uncaught exception — so the programme is never left in a
-- half-imported state; "500 valid rows, 3 rejected" commits the 500
-- and reports the 3, but "the database itself failed halfway through"
-- commits nothing at all.
create or replace function public.import_programme_activities(p_programme_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_row jsonb;
  v_index int;
  v_external_id text;
  v_title text;
  v_planned_start date;
  v_planned_finish date;
  v_is_milestone boolean;
  v_plot_id uuid;
  v_plot_project_id uuid;
  v_existing_id uuid;
  v_match_count int;
  v_match_ids uuid[];
  v_created int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_created_ids uuid[] := '{}';
  v_updated_ids uuid[] := '{}';
  v_dup_external_ids text[];
  v_old record;
begin
  select project_id, org_id into v_project_id, v_org_id from public.programmes where id = p_programme_id;
  if v_project_id is null then
    raise exception 'import_programme_activities: programme not found';
  end if;
  if not public.is_project_editor(v_project_id) then
    raise exception 'import_programme_activities: not authorized for this project';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_programme_activities: p_rows must be a JSON array';
  end if;
  -- A hard cap, matching what this phase's own performance testing
  -- actually covers (up to 5,000 rows) — re-checked here, not only in
  -- the UI, since this RPC could in principle be called directly.
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'import_programme_activities: an import batch is limited to 5000 rows (received %); split it into smaller imports', jsonb_array_length(p_rows);
  end if;

  -- Duplicate external_ids WITHIN this payload — re-validated here,
  -- server-side, against the payload actually received (never trusts
  -- the client's own pre-check alone).
  select array_agg(external_id) into v_dup_external_ids
  from (
    select (r->>'external_id') as external_id, count(*)
    from jsonb_array_elements(p_rows) as r
    where r->>'external_id' is not null and trim(r->>'external_id') <> ''
    group by 1
    having count(*) > 1
  ) d;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_index := coalesce((v_row->>'client_row_index')::int, -1);
    v_external_id := nullif(trim(v_row->>'external_id'), '');
    v_title := trim(coalesce(v_row->>'title', ''));
    v_planned_start := nullif(v_row->>'planned_start', '')::date;
    v_planned_finish := nullif(v_row->>'planned_finish', '')::date;
    v_is_milestone := coalesce((v_row->>'is_milestone')::boolean, false);
    v_plot_id := nullif(v_row->>'plot_id', '')::uuid;

    if v_title = '' then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'Title is required.');
      continue;
    end if;

    if v_external_id is not null and v_dup_external_ids is not null and v_external_id = any(v_dup_external_ids) then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', format('Duplicate external_id "%s" appears more than once in this import.', v_external_id));
      continue;
    end if;

    if v_plot_id is not null then
      select project_id into v_plot_project_id from public.plots where id = v_plot_id;
      if v_plot_project_id is null or v_plot_project_id <> v_project_id then
        v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'plot_id does not belong to this project.');
        continue;
      end if;
    end if;

    v_existing_id := null;
    if v_external_id is not null then
      select id into v_existing_id from public.programme_activities
        where programme_id = p_programme_id and external_id = v_external_id;
    else
      -- Fallback: (plot_id, lower(trim(title))) among existing rows
      -- that themselves have no external_id — an externally-identified
      -- activity is only ever matched by its own external_id, never
      -- coincidentally by title (the Phase 2 rule, re-enforced here).
      -- array_agg rather than min(id): Postgres has no MIN() aggregate
      -- for uuid.
      select array_agg(id) into v_match_ids
      from public.programme_activities
      where programme_id = p_programme_id
        and external_id is null
        and lower(trim(title)) = lower(v_title)
        and coalesce(plot_id::text, '') = coalesce(v_plot_id::text, '');
      v_match_count := coalesce(array_length(v_match_ids, 1), 0);
      if v_match_count > 1 then
        v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', 'Ambiguous match — more than one existing activity matches this title/plot with no external_id. Add an external_id to disambiguate, or resolve the duplicates manually first.');
        continue;
      end if;
      v_existing_id := case when v_match_count = 1 then v_match_ids[1] else null end;
    end if;

    if v_existing_id is null then
      insert into public.programme_activities (programme_id, plot_id, title, external_id, is_milestone, planned_start, planned_finish)
      values (p_programme_id, v_plot_id, v_title, v_external_id, v_is_milestone, v_planned_start, v_planned_finish)
      returning id into v_existing_id;
      v_created := v_created + 1;
      v_created_ids := v_created_ids || v_existing_id;
    else
      select plot_id, title, external_id, is_milestone, planned_start, planned_finish
        into v_old
        from public.programme_activities where id = v_existing_id;

      if v_old.plot_id is distinct from v_plot_id
         or v_old.title is distinct from v_title
         or v_old.external_id is distinct from v_external_id
         or v_old.is_milestone is distinct from v_is_milestone
         or v_old.planned_start is distinct from v_planned_start
         or v_old.planned_finish is distinct from v_planned_finish
      then
        update public.programme_activities
          set plot_id = v_plot_id, title = v_title, external_id = v_external_id,
              is_milestone = v_is_milestone, planned_start = v_planned_start, planned_finish = v_planned_finish
          where id = v_existing_id;
        v_updated := v_updated + 1;
        v_updated_ids := v_updated_ids || v_existing_id;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'rejected', v_rejected,
    'created_ids', to_jsonb(v_created_ids),
    'updated_ids', to_jsonb(v_updated_ids)
  );
end;
$$;

grant execute on function public.import_programme_activities(uuid, jsonb) to authenticated;

-- ─── Optional raw workbook retention (Documents integration) ────────
-- Priority 10 deliberately designed documents.document_type so
-- "additional document types can be added later without schema
-- redesign" — this is exactly that: one additive value, no new table,
-- no new storage bucket, no new upload path. The importer MAY offer
-- to retain the uploaded workbook as a controlled document afterwards
-- (createDocument(projectId, {documentType:'programme', ...}, file) —
-- already-existing, unmodified Priority 10 code); this migration only
-- makes that document_type value legal to store.
alter table public.documents drop constraint if exists documents_document_type_check;
alter table public.documents add constraint documents_document_type_check
  check (document_type in ('drawing', 'specification', 'other', 'programme'));

-- ─── v37 ADDITIONS: Programme Variance + Action Link (Phase 4) ──────
-- Adds ONE nullable column — programme_activities.action_id — so a
-- programme exception (an overdue/forecast-late activity or
-- milestone) can be turned into an explicit, trackable Action without
-- the application inventing a parallel identity model. Mirrors
-- inspection_findings.action_id / snag_items.action_id EXACTLY: the
-- origin (a programme activity) references its consequence (an
-- action), never the reverse, keeping the reusable Actions Engine
-- (Priority 5) uncoupled from Programme Control. No Action is ever
-- created automatically by this migration or by any programme-
-- variance calculation — see createActionFromProgrammeActivity() in
-- tracker/js/app.js, an explicit, user-initiated "Create Action"
-- call, the same shape createActionFromFinding()/
-- createActionFromSnag() already established.
alter table public.programme_activities add column if not exists action_id uuid references public.actions(id) on delete set null;
create index if not exists programme_activities_action_idx on public.programme_activities (action_id);

-- Re-declares programme_activities_before_write() with ONE addition —
-- action_id, if supplied, must reference a real action belonging to
-- the SAME project as the activity (the same IDOR class every other
-- action_id/plot_id/assigned_to check in this schema already closes).
-- Every other line is byte-identical to the v35 original.
create or replace function public.programme_activities_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_plot_project_id uuid;
  v_action_project_id uuid;
begin
  select project_id, org_id into v_project_id, v_org_id from public.programmes where id = new.programme_id;
  if v_project_id is null then
    raise exception 'programme_activities.programme_id must reference an existing programme';
  end if;
  new.project_id := v_project_id;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'programme_activities.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the programme activity';
    end if;
  end if;

  if new.assigned_to is not null and not public.is_project_member_user(new.project_id, new.assigned_to) then
    raise exception 'assigned_to must be a member of this project';
  end if;

  if new.action_id is not null then
    select project_id into v_action_project_id from public.actions where id = new.action_id;
    if v_action_project_id is null then
      raise exception 'programme_activities.action_id must reference an existing action';
    end if;
    if v_action_project_id <> new.project_id then
      raise exception 'a linked action must belong to the same project as the programme activity';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    if new.forecast_start is null then new.forecast_start := new.planned_start; end if;
    if new.forecast_finish is null then new.forecast_finish := new.planned_finish; end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  -- "complete should require appropriate completion state": force
  -- percent_complete to 100 on transition into complete (never trust
  -- a lower client-supplied value), and stamp actual_finish once, on
  -- the transition, only if the client didn't already supply a real
  -- date — never force-overwritten on every subsequent save the way
  -- actions.completed_at is, since actual_finish is a real-world
  -- construction date a user may need to correct afterwards while
  -- status stays 'complete'.
  if new.status = 'complete' then
    new.percent_complete := 100;
    if TG_OP = 'INSERT' or old.status <> 'complete' then
      if new.actual_finish is null then
        new.actual_finish := current_date;
      end if;
    end if;
  elsif new.status = 'not_started' then
    new.percent_complete := 0;
  end if;
  -- Reopening a previously-complete activity (status moving away from
  -- 'complete') deliberately leaves actual_finish untouched — it
  -- remains a true historical record of when the work was actually
  -- finished, even if the row is reopened later for correction. This
  -- is the one deliberate divergence from actions.completed_at, which
  -- always clears on reopen; construction reality (a real date the
  -- work stopped) doesn't become untrue just because the record is
  -- reopened.

  return new;
end;
$$;


-- ─── v38 ADDITIONS: Plot Control Data Linkage (Priority 13) ──────────
--
-- Priority 12 Phase 1 built a plot-level readiness position from data
-- that was ALREADY plot-linked (Quality Gates, Handover Documents,
-- Programme Activities' own plot_id, Snags via their plot's snag
-- list) and deliberately left Actions and Inspection Findings
-- project-level, pending a real architectural decision. That decision,
-- made after re-inspecting every Action/Finding creation path and
-- finding zero existing production rows of either (a clean slate —
-- no historical backfill question at all):
--
--   actions.plot_id            ADD (nullable) — populated ONLY by
--     automatic inheritance from the source entity a "Create Action
--     from X" flow already knows the plot of (a Snag via its list, a
--     Programme Activity via its own plot_id, an Inspection Finding
--     via its own new plot_id below). Direct/manual Action creation
--     (actions.html, always project-scoped) leaves it null — that is
--     correct, not a gap; see tracker/README.md.
--
--   inspection_findings.plot_id ADD (nullable) — captured via a small
--     optional "Plot" field on the Add Finding form, the same
--     established convention snag_items' own general-list plot picker
--     already uses. Deliberately NOT added to `inspections` itself:
--     an inspection is frequently a walk-round spanning many plots or
--     none, while an individual finding ("missing bracing") is the
--     naturally plot-scoped unit — adding plot_id to BOTH parent and
--     child would create two authoritative sources that could
--     disagree, which the brief's own "one authoritative relationship"
--     principle rules out. No current UI path lets a user start an
--     Inspection FROM a specific plot, so there is nothing to
--     auto-inherit from at that level; inventing that launch flow
--     would be a UI redesign this phase does not attempt.
--
-- Both columns are validated server-side to belong to the SAME
-- project as the row itself — the identical IDOR-closing pattern
-- programme_activities.plot_id already established in v35/v37, not a
-- new one.
alter table public.actions add column if not exists plot_id uuid references public.plots(id) on delete set null;
alter table public.inspection_findings add column if not exists plot_id uuid references public.plots(id) on delete set null;

create or replace function public.actions_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_plot_project_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'actions.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'actions.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the action';
    end if;
  end if;

  if new.assigned_to is not null and not public.is_project_editor_user(new.project_id, new.assigned_to) then
    raise exception 'assigned_to must be a project editor (owner or collaborator) for this project';
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
  else
    if new.status <> old.status and not public.valid_action_status_transition(old.status, new.status) then
      raise exception 'Invalid action status transition: % -> %', old.status, new.status;
    end if;
    -- creator/creation time are immutable once set, regardless of what
    -- an UPDATE payload includes.
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  -- completed_at reflects the moment status most recently BECAME
  -- 'completed' — set on the transition in, left untouched while it
  -- stays 'completed' (so re-saving other fields doesn't reset it), and
  -- cleared the moment status moves away from 'completed' (reopening).
  if new.status = 'completed' and (TG_OP = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.inspection_findings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_inspection_project_id uuid;
  v_action_project_id uuid;
  v_plot_project_id uuid;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'inspection_findings.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  select project_id into v_inspection_project_id from public.inspections where id = new.inspection_id;
  if v_inspection_project_id is null then
    raise exception 'inspection_findings.inspection_id must reference an existing inspection';
  end if;
  if v_inspection_project_id <> new.project_id then
    raise exception 'a finding''s project_id must match its inspection''s project_id';
  end if;

  if new.action_id is not null then
    select project_id into v_action_project_id from public.actions where id = new.action_id;
    if v_action_project_id is null then
      raise exception 'inspection_findings.action_id must reference an existing action';
    end if;
    if v_action_project_id <> new.project_id then
      raise exception 'a linked action must belong to the same project as the finding';
    end if;
  end if;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'inspection_findings.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the finding';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.resolved_at := case when new.status = 'resolved' then now() else null end;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;

  return new;
end;
$$;

-- Audit integration: actions/inspection_findings have been audited
-- since v29/v31 respectively (trg_audit_actions/
-- trg_audit_inspection_findings), via write_audit_log()'s existing
-- generic project_id-based branch. plot_id is just another column on
-- an already-audited row — it appears in old_data/new_data
-- automatically the moment the trigger functions above start setting
-- it, with zero changes to the audit trigger or write_audit_log()
-- itself. Proven by test, not re-implemented — see
-- tests/security/plot_action_finding_linkage.test.mjs.


-- ─── v39 ADDITIONS: Handover State Consistency (Priority 15, Phase 1) ──
--
-- The JS readiness engine (computePlotHandoverReadiness, tracker/js/
-- app.js) already treats a plot's Quality Gates, Handover Documents,
-- high-priority overdue Snags, blocked/overdue-high-critical Actions,
-- and unresolved critical Inspection Findings as hard BLOCKERS to
-- handover, while Programme variance and every lesser condition is
-- only ever a WARNING (at_risk), never a blocker. Until now,
-- checkAndMarkPlotHandedOver() — the ONLY code path anywhere in this
-- app that writes plots.handed_over_at — only ever checked Quality
-- Gates and Handover Documents, so a plot could be silently stamped
-- "handed over" while readiness would simultaneously report it NOT
-- READY. Priority 14's operational stress test flagged this as the
-- one genuine correctness bug it found; this migration fixes it.
--
-- The JS readiness function is pure/frontend-only and cannot run
-- inside a Postgres trigger, so it cannot literally be reused here —
-- but the real reason a DB-side check is required isn't just
-- belt-and-suspenders consistency, it's security: plots' own UPDATE
-- policy ("editors update plots", above) lets any project editor
-- update ANY column on their project's plots, including
-- handed_over_at directly, entirely bypassing the JS layer (e.g. a
-- hand-crafted API call). A client-side check alone is not a real
-- enforcement boundary in this app's architecture — every other
-- server-side invariant here (plot_id project-matching on actions/
-- inspection_findings/programme_activities, action status-transition
-- validity, etc.) is already enforced in a trigger, not just in the
-- UI, and this is held to the same standard.
--
-- This trigger deliberately mirrors ONLY the five BLOCKER predicates
-- already established in computePlotHandoverReadiness — never its
-- warnings (Programme variance, non-blocking Snags/Actions/Findings
-- explicitly must NOT prevent handover, matching existing semantics
-- exactly) and never its full precedence/status/label logic (that
-- stays exactly where it is, in the JS readiness engine, as the
-- single source of truth for what a user SEES). This is the smallest
-- safe alternative to literally sharing code across languages: a
-- narrow, independently-reasoned safety net, not a second UI.
create or replace function public.plots_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate_outstanding boolean;
  v_doc_outstanding boolean;
  v_snag_blocking boolean;
  v_action_blocking boolean;
  v_finding_blocking boolean;
begin
  if TG_OP = 'UPDATE' and new.handed_over_at is distinct from old.handed_over_at then
    -- A historical handover record must never be silently rewritten or
    -- cleared — handed_over_at is a one-time, permanent event, not a
    -- continuously recalculated field (see computePlotHandoverReadiness's
    -- own status precedence: "handed_over" always wins, regardless of
    -- current readiness). There is no "un-handover" feature in this
    -- application, and this is not the phase to add one.
    if old.handed_over_at is not null then
      raise exception 'plots.handed_over_at is a historical record and cannot be changed once set';
    end if;

    -- old.handed_over_at is null here, new.handed_over_at is being set
    -- for the first time — validate against the same blocker rules
    -- computePlotHandoverReadiness() already uses. Warnings (Programme
    -- variance, non-blocking Snags/Actions/Findings) are deliberately
    -- NOT checked here — they make a plot AT RISK, not NOT READY, and
    -- must not prevent the historical handover event.

    select count(*) > 0 and bool_or(status not in ('approved', 'not_applicable'))
      into v_gate_outstanding
      from public.quality_gates where plot_id = new.id;

    select count(*) > 0 and bool_or(status <> 'approved_final')
      into v_doc_outstanding
      from public.handover_documents where plot_id = new.id;

    -- Snags: a plot's own auto-seeded list (snag_lists.plot_id) is the
    -- normal path; snag_items.plot_id itself is only populated for the
    -- rare general/site-wide list's optional per-item tag — both are
    -- checked here, exactly like every other plot-scoped snag query in
    -- this app (see getPlotSnags()/getProjectPlotReadiness() in
    -- tracker/js/app.js).
    select exists (
      select 1 from public.snag_items si
      left join public.snag_lists sl on sl.id = si.snag_list_id
      where coalesce(si.plot_id, sl.plot_id) = new.id
        and si.status = 'open' and si.priority = 'high'
        and si.due_date is not null and si.due_date < current_date
    ) into v_snag_blocking;

    select exists (
      select 1 from public.actions
      where plot_id = new.id
        and status not in ('completed', 'cancelled')
        and (status = 'blocked' or (due_date is not null and due_date < current_date and priority in ('high', 'critical')))
    ) into v_action_blocking;

    select exists (
      select 1 from public.inspection_findings
      where plot_id = new.id
        and status not in ('resolved', 'accepted', 'cancelled')
        and severity = 'critical'
    ) into v_finding_blocking;

    if coalesce(v_gate_outstanding, false) then
      raise exception 'Cannot record handover: outstanding Quality Gate(s) for this plot';
    end if;
    if coalesce(v_doc_outstanding, false) then
      raise exception 'Cannot record handover: outstanding Handover Document(s) for this plot';
    end if;
    if v_snag_blocking then
      raise exception 'Cannot record handover: open high-priority overdue Snag(s) for this plot';
    end if;
    if v_action_blocking then
      raise exception 'Cannot record handover: blocked or overdue high/critical-priority Action(s) for this plot';
    end if;
    if v_finding_blocking then
      raise exception 'Cannot record handover: unresolved critical Inspection Finding(s) for this plot';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_plots_before_write on public.plots;
create trigger trg_plots_before_write
  before update on public.plots
  for each row execute function public.plots_before_write();

-- ─── v40 ADDITIONS: Commercial Module — Phase 0 (Database Foundation) ──
-- Platform module-permission layer (module_roles / project_module_roles)
-- plus the Commercial shared-spine schema (commercial_events, variations,
-- dayworks, commercial_line_items, variation_dayworks,
-- commercial_evidence_links, commercial_signatures), DB-enforced pricing
-- (generated line_total, a trigger-maintained total_value cache, and the
-- commercial_event_totals view as the authoritative figure), and DB-
-- enforced workflow (draft -> submitted -> approved/rejected, immutable
-- once approved, self-approval blocked). No frontend in this phase —
-- see tracker/README.md once a later phase adds pages.
--
-- commercial_items (the existing informal weekly-report ledger) is
-- untouched by this migration — it is a deliberately separate, smaller
-- system serving a different purpose; see the architecture review.

-- ─── Platform module-permission layer ──────────────────────────────
-- Generalises "editor rights on a project" and "capability within one
-- specific module" into two separate things — Commercial is the first
-- consumer, but nothing here is Commercial-specific; a future module
-- reuses the same two tables and adds its own (module, role) rows plus
-- its own small set of can_*() helper functions.

-- Static, admin-maintained reference data: every (module, role) pair
-- that can ever be granted. Enabled RLS with only a SELECT policy is
-- the same "reference data, no client writes" pattern already used for
-- generic read-only reference lists elsewhere in this app.
create table if not exists public.module_roles (
  module text not null,
  role text not null,
  sort_order integer not null default 0,
  primary key (module, role)
);

insert into public.module_roles (module, role, sort_order) values
  ('commercial', 'viewer', 1),
  ('commercial', 'contributor', 2),
  ('commercial', 'approver', 3)
on conflict (module, role) do nothing;

alter table public.module_roles enable row level security;
drop policy if exists "authenticated read module_roles" on public.module_roles;
create policy "authenticated read module_roles" on public.module_roles for select using (auth.role() = 'authenticated');
-- No insert/update/delete policy for any role — RLS enabled, unpolicied
-- for writes, so Postgres denies them by default to every client; this
-- table is edited only by re-running schema.sql, exactly like
-- module_roles' own seed data above.

-- The actual grants: which module-scoped role (if any) a specific user
-- holds on a specific project. General project_members.role (owner/
-- collaborator/snagging) is completely unchanged and untouched by this
-- table — a project_module_roles grant is an ADDITIONAL, narrower gate
-- layered on top of (never a replacement for) ordinary project
-- membership; see commercial_role() below, which requires both.
create table if not exists public.project_module_roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null,
  role text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (project_id, user_id, module),
  foreign key (module, role) references public.module_roles (module, role)
);

create index if not exists project_module_roles_project_module_idx on public.project_module_roles (project_id, module);
create index if not exists project_module_roles_user_idx on public.project_module_roles (user_id);

alter table public.project_module_roles enable row level security;

-- Any project member can see who holds what module access on their own
-- project (matching this app's existing "Collaborators" list visibility
-- — membership/role information is not itself sensitive the way the
-- underlying module data might be).
drop policy if exists "members read project_module_roles" on public.project_module_roles;
create policy "members read project_module_roles" on public.project_module_roles for select using (public.is_project_member(project_id));

-- Project OWNER only may grant/revoke — never org admin. Verified
-- against the existing schema before writing this: is_org_admin() is
-- used today only for organisation-level actions (updating the
-- organisation itself, removing an organisation member) and never to
-- bypass a project-level is_project_owner() check anywhere in this
-- file — so there is no existing precedent to extend, and none is
-- introduced here.
drop policy if exists "owners insert project_module_roles" on public.project_module_roles;
create policy "owners insert project_module_roles" on public.project_module_roles for insert with check (public.is_project_owner(project_id));
drop policy if exists "owners update project_module_roles" on public.project_module_roles;
create policy "owners update project_module_roles" on public.project_module_roles for update using (public.is_project_owner(project_id));
drop policy if exists "owners delete project_module_roles" on public.project_module_roles;
create policy "owners delete project_module_roles" on public.project_module_roles for delete using (public.is_project_owner(project_id));

drop trigger if exists trg_audit_project_module_roles on public.project_module_roles;
create trigger trg_audit_project_module_roles
  after insert or update or delete on public.project_module_roles
  for each row execute function public.write_audit_log();

-- ─── Commercial permission helpers ─────────────────────────────────
-- The caller's own effective role for `module` on a project, or null if
-- none. Deliberately composes with (never re-derives) is_project_member()
-- so a module grant can never outrun the platform's own real membership
-- boundary — if is_project_member() is ever tightened later, this
-- follows automatically rather than needing a matching update here.
create or replace function public.project_module_role(p_project_id uuid, p_module text)
returns text
language sql stable security definer set search_path = public
as $$
  select pmr.role
  from public.project_module_roles pmr
  where pmr.project_id = p_project_id
    and pmr.user_id = auth.uid()
    and pmr.module = p_module
    and public.is_project_member(p_project_id);
$$;

create or replace function public.can_view_commercial(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'commercial') in ('viewer', 'contributor', 'approver');
$$;

create or replace function public.can_edit_commercial(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'commercial') in ('contributor', 'approver');
$$;

create or replace function public.can_submit_commercial(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'commercial') in ('contributor', 'approver');
$$;

create or replace function public.can_approve_commercial(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'commercial') = 'approver';
$$;

-- ─── commercial_events — the shared spine ──────────────────────────
create table if not exists public.commercial_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  plot_id uuid references public.plots(id) on delete set null,
  type text not null check (type in ('variation', 'daywork')),
  reference text,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  -- Performance cache only — trigger-maintained, NEVER the authoritative
  -- figure. commercial_event_totals (below) is authoritative; anything
  -- approval/signature-critical must read the view, not this column.
  total_value numeric(12,2) not null default 0,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references auth.users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  -- Post-approval amendment path: a new row referencing the one it
  -- corrects. Phase 0 only adds the column + FK; no revision UI yet.
  supersedes_id uuid references public.commercial_events(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_events_project_status_idx on public.commercial_events (project_id, status);
create index if not exists commercial_events_project_type_idx on public.commercial_events (project_id, type);

alter table public.commercial_events enable row level security;

drop policy if exists "commercial viewers read commercial_events" on public.commercial_events;
create policy "commercial viewers read commercial_events" on public.commercial_events for select using (public.can_view_commercial(project_id));
drop policy if exists "commercial contributors insert commercial_events" on public.commercial_events;
create policy "commercial contributors insert commercial_events" on public.commercial_events for insert with check (public.can_edit_commercial(project_id));
drop policy if exists "commercial contributors update commercial_events" on public.commercial_events;
create policy "commercial contributors update commercial_events" on public.commercial_events for update using (public.can_edit_commercial(project_id));
-- No delete policy — deliberately out of Phase 0's scope; see final report.

drop trigger if exists trg_audit_commercial_events on public.commercial_events;
create trigger trg_audit_commercial_events
  after insert or update or delete on public.commercial_events
  for each row execute function public.write_audit_log();

-- ─── variations / dayworks — 1:1 extensions of the spine ───────────
-- `id` and `project_id` here are NOT the primary key (commercial_event_id
-- is, per the approved architecture) — they exist solely so
-- write_audit_log()'s generic lookups (`(to_jsonb(row)->>'id')::uuid`
-- and `(to_jsonb(row)->>'project_id')::uuid`) work unchanged for these
-- two tables, exactly like `document_revisions.project_id` is already
-- denormalized elsewhere in this schema "so RLS doesn't need a two-hop
-- join." write_audit_log() already special-cases `projects` and
-- `org_settings` for the same underlying reason (their real identity
-- isn't a plain id+project_id pair either); matching that existing
-- shape on our own new tables is a smaller, safer fix than adding a
-- third special case to a function 15 existing tables already depend
-- on. project_id is trigger-populated below, never client-writable.
create table if not exists public.variations (
  commercial_event_id uuid primary key references public.commercial_events(id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  date_identified date,
  date_instructed date,
  instruction_reference text,
  instructed_by text,
  reason text,
  markup_pct numeric(5,2) not null default 0
);

create table if not exists public.dayworks (
  commercial_event_id uuid primary key references public.commercial_events(id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  date_undertaken date
);

-- A variations/dayworks row must point at a commercial_event of the
-- matching type — Postgres has no native cross-table "this FK's target
-- must also satisfy X" constraint, so this is the trigger-enforced
-- equivalent. Also derives project_id server-side (never client-
-- trusted, matching actions_before_write()'s own org_id-derivation
-- pattern) and keeps it immutable on UPDATE. commercial_event_id is the
-- PK, so both only ever apply at INSERT in practice, but the functions
-- fire on UPDATE too so project_id can never be tampered with even if a
-- client tries to include it in a later edit payload.
create or replace function public.variations_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.commercial_events where id = new.commercial_event_id and type = 'variation';
  if v_project_id is null then
    raise exception 'variations.commercial_event_id must reference a commercial_events row of type ''variation''';
  end if;
  new.project_id := v_project_id;
  return new;
end;
$$;
drop trigger if exists trg_variations_before_write on public.variations;
create trigger trg_variations_before_write
  before insert or update on public.variations
  for each row execute function public.variations_before_write();

create or replace function public.dayworks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.commercial_events where id = new.commercial_event_id and type = 'daywork';
  if v_project_id is null then
    raise exception 'dayworks.commercial_event_id must reference a commercial_events row of type ''daywork''';
  end if;
  new.project_id := v_project_id;
  return new;
end;
$$;
drop trigger if exists trg_dayworks_before_write on public.dayworks;
create trigger trg_dayworks_before_write
  before insert or update on public.dayworks
  for each row execute function public.dayworks_before_write();

alter table public.variations enable row level security;
drop policy if exists "commercial viewers read variations" on public.variations;
create policy "commercial viewers read variations" on public.variations for select using (
  exists (select 1 from public.commercial_events ce where ce.id = variations.commercial_event_id and public.can_view_commercial(ce.project_id))
);
drop policy if exists "commercial contributors insert variations" on public.variations;
create policy "commercial contributors insert variations" on public.variations for insert with check (
  exists (select 1 from public.commercial_events ce where ce.id = variations.commercial_event_id and public.can_edit_commercial(ce.project_id))
);
drop policy if exists "commercial contributors update variations" on public.variations;
create policy "commercial contributors update variations" on public.variations for update using (
  exists (select 1 from public.commercial_events ce where ce.id = variations.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);

alter table public.dayworks enable row level security;
drop policy if exists "commercial viewers read dayworks" on public.dayworks;
create policy "commercial viewers read dayworks" on public.dayworks for select using (
  exists (select 1 from public.commercial_events ce where ce.id = dayworks.commercial_event_id and public.can_view_commercial(ce.project_id))
);
drop policy if exists "commercial contributors insert dayworks" on public.dayworks;
create policy "commercial contributors insert dayworks" on public.dayworks for insert with check (
  exists (select 1 from public.commercial_events ce where ce.id = dayworks.commercial_event_id and public.can_edit_commercial(ce.project_id))
);
drop policy if exists "commercial contributors update dayworks" on public.dayworks;
create policy "commercial contributors update dayworks" on public.dayworks for update using (
  exists (select 1 from public.commercial_events ce where ce.id = dayworks.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);

drop trigger if exists trg_audit_variations on public.variations;
create trigger trg_audit_variations
  after insert or update or delete on public.variations
  for each row execute function public.write_audit_log();
drop trigger if exists trg_audit_dayworks on public.dayworks;
create trigger trg_audit_dayworks
  after insert or update or delete on public.dayworks
  for each row execute function public.write_audit_log();

-- ─── commercial_line_items ──────────────────────────────────────────
-- Corrected architecture: a single, non-nullable, real FK straight to
-- the shared spine (commercial_events), never a polymorphic
-- parent_type/parent_id pointer and never two nullable FKs to the
-- extension tables. This is stronger than either alternative (a real,
-- mandatory FK Postgres itself enforces) and needs zero schema change
-- as future commercial_event types are added later.
create table if not exists public.commercial_line_items (
  id uuid primary key default gen_random_uuid(),
  commercial_event_id uuid not null references public.commercial_events(id) on delete cascade,
  -- Denormalized, trigger-populated (never client-writable) — needed
  -- purely so write_audit_log()'s generic project_id lookup works for
  -- this table, matching document_revisions.project_id's own existing
  -- denormalization in this schema for the identical reason.
  project_id uuid not null references public.projects(id) on delete cascade,
  line_type text not null check (line_type in ('labour', 'plant', 'material', 'subcontractor', 'other')),
  description text not null,
  trade text,
  quantity numeric(10,2) not null default 1 check (quantity >= 0),
  unit text,
  -- Nullable = TBC (not yet priced), distinct from a genuine zero rate.
  -- Negative rates are permitted deliberately, for omission lines.
  rate numeric(12,4),
  -- Postgres-computed, never client-trusted: NULL rate propagates to a
  -- NULL line_total automatically (excluded from SUM() with no special
  -- casing needed), and any inserted/updated quantity/rate pair is
  -- rounded to 2dp by ordinary numeric-type scale coercion — verified
  -- empirically against this project's actual Postgres 16 before this
  -- migration was written (round-half-away-from-zero: 1 x 2.005 ->
  -- 2.01), not merely assumed from documentation.
  line_total numeric(12,2) generated always as (quantity * rate) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists commercial_line_items_event_idx on public.commercial_line_items (commercial_event_id);

-- Shared by every table below whose own project_id is denormalized
-- purely for write_audit_log() compatibility (see the comment on
-- commercial_line_items.project_id above) — one generic function
-- reused across commercial_line_items/commercial_evidence_links/
-- commercial_signatures, matching write_audit_log() itself being one
-- generic function reused across every audited table rather than one
-- per table.
create or replace function public.derive_project_id_from_commercial_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select project_id into new.project_id from public.commercial_events where id = new.commercial_event_id;
  if new.project_id is null then
    raise exception '%.commercial_event_id must reference an existing commercial_events row', TG_TABLE_NAME;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_commercial_line_items_project_id on public.commercial_line_items;
create trigger trg_commercial_line_items_project_id
  before insert or update on public.commercial_line_items
  for each row execute function public.derive_project_id_from_commercial_event();

alter table public.commercial_line_items enable row level security;

drop policy if exists "commercial viewers read commercial_line_items" on public.commercial_line_items;
create policy "commercial viewers read commercial_line_items" on public.commercial_line_items for select using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_line_items.commercial_event_id and public.can_view_commercial(ce.project_id))
);
-- Every write policy independently re-checks the PARENT's live status
-- (draft/rejected only) on every single call — this is the child-table
-- lock enforcement the parent trigger alone cannot provide, required
-- specifically so line items stay immutable once their event is
-- submitted or approved even if a client calls this table directly.
drop policy if exists "commercial contributors insert commercial_line_items" on public.commercial_line_items;
create policy "commercial contributors insert commercial_line_items" on public.commercial_line_items for insert with check (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_line_items.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);
drop policy if exists "commercial contributors update commercial_line_items" on public.commercial_line_items;
create policy "commercial contributors update commercial_line_items" on public.commercial_line_items for update using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_line_items.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);
drop policy if exists "commercial contributors delete commercial_line_items" on public.commercial_line_items;
create policy "commercial contributors delete commercial_line_items" on public.commercial_line_items for delete using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_line_items.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);

drop trigger if exists trg_audit_commercial_line_items on public.commercial_line_items;
create trigger trg_audit_commercial_line_items
  after insert or update or delete on public.commercial_line_items
  for each row execute function public.write_audit_log();

-- ─── variation_dayworks ─────────────────────────────────────────────
-- FKs point at variations(commercial_event_id) / dayworks(commercial_event_id)
-- rather than commercial_events(id) directly — a structural guarantee
-- that variation_id can only ever hold a genuine Variation's id and
-- daywork_id only ever a genuine Daywork's, since neither value could
-- otherwise exist in that extension table at all. This is what actually
-- "prevents a Daywork from indirectly linking to itself" — a Daywork's
-- own id is never a valid value for variation_id, full stop.
-- id + project_id: same write_audit_log() compatibility reasoning as
-- variations/dayworks above — this table's real identity is the
-- (variation_id, daywork_id) composite PK, not a plain id.
create table if not exists public.variation_dayworks (
  variation_id uuid not null references public.variations(commercial_event_id) on delete cascade,
  daywork_id uuid not null references public.dayworks(commercial_event_id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (variation_id, daywork_id)
);

create index if not exists variation_dayworks_daywork_idx on public.variation_dayworks (daywork_id);

create or replace function public.variation_dayworks_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daywork_project_id uuid;
begin
  select project_id into new.project_id from public.variations where commercial_event_id = new.variation_id;
  if new.project_id is null then
    raise exception 'variation_dayworks.variation_id must reference an existing variations row';
  end if;

  -- SECURITY FIX (Phase 2): the original Phase 0 trigger validated only
  -- that variation_id points at a real variations row — it never
  -- checked that the daywork being linked belongs to the SAME project.
  -- Confirmed exploitable: a contributor with edit access on their own
  -- project's variation could link an arbitrary daywork_id from ANY
  -- other project (including another organisation's), folding that
  -- daywork's total_value into their own variation's total via
  -- recompute_commercial_event_total() — a genuine cross-tenant value
  -- leak, found and fixed before any Variation UI existed to surface
  -- it. This check is deliberately duplicated at the RLS layer below
  -- (the insert policy on variation_dayworks) rather than relied on
  -- here alone, matching this schema's established "child locking must
  -- be enforced independently at both layers" precedent.
  select project_id into v_daywork_project_id from public.dayworks where commercial_event_id = new.daywork_id;
  if v_daywork_project_id is null then
    raise exception 'variation_dayworks.daywork_id must reference an existing dayworks row';
  end if;
  if v_daywork_project_id <> new.project_id then
    raise exception 'A Daywork can only be linked to a Variation on the same project';
  end if;

  return new;
end;
$$;
drop trigger if exists trg_variation_dayworks_before_insert on public.variation_dayworks;
create trigger trg_variation_dayworks_before_insert
  before insert on public.variation_dayworks
  for each row execute function public.variation_dayworks_before_insert();

alter table public.variation_dayworks enable row level security;
drop policy if exists "commercial viewers read variation_dayworks" on public.variation_dayworks;
create policy "commercial viewers read variation_dayworks" on public.variation_dayworks for select using (
  exists (select 1 from public.commercial_events ce where ce.id = variation_dayworks.variation_id and public.can_view_commercial(ce.project_id))
);
drop policy if exists "commercial contributors insert variation_dayworks" on public.variation_dayworks;
-- SECURITY FIX (Phase 2): also requires the daywork's own commercial_events
-- row to share the variation's project_id — see variation_dayworks_before_
-- insert()'s comment above for the vulnerability this closes. Independent
-- of the trigger's own check: even if the trigger were ever bypassed or
-- changed, this policy alone still prevents the cross-project link.
create policy "commercial contributors insert variation_dayworks" on public.variation_dayworks for insert with check (
  exists (
    select 1
    from public.commercial_events v_ce
    join public.commercial_events d_ce on d_ce.id = variation_dayworks.daywork_id
    where v_ce.id = variation_dayworks.variation_id
      and v_ce.project_id = d_ce.project_id
      and public.can_edit_commercial(v_ce.project_id)
      and v_ce.status in ('draft', 'rejected')
  )
);
drop policy if exists "commercial contributors delete variation_dayworks" on public.variation_dayworks;
create policy "commercial contributors delete variation_dayworks" on public.variation_dayworks for delete using (
  exists (select 1 from public.commercial_events ce where ce.id = variation_dayworks.variation_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);

drop trigger if exists trg_audit_variation_dayworks on public.variation_dayworks;
create trigger trg_audit_variation_dayworks
  after insert or update or delete on public.variation_dayworks
  for each row execute function public.write_audit_log();

-- ─── Pricing authority: total_value recompute (event totals) ──────
-- Daywork total = sum of its own line items.
-- Variation total = its own direct line items (commercial_event_id on
-- commercial_line_items points at the VARIATION's own event id, never
-- at a linked Daywork's) + the sum of each linked Daywork's own
-- total_value (never that Daywork's raw line items directly — reading
-- its already-computed total avoids ever double-summing the same line
-- item through two different paths) + markup applied to that combined
-- subtotal.
create or replace function public.recompute_commercial_event_total(p_commercial_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_own_subtotal numeric(12,2);
  v_dayworks_subtotal numeric(12,2);
  v_markup_pct numeric(5,2);
  v_total numeric(12,2);
begin
  select type into v_type from public.commercial_events where id = p_commercial_event_id;
  if v_type is null then
    return; -- event no longer exists (e.g. mid-cascade delete elsewhere) — nothing to do
  end if;

  select coalesce(sum(line_total), 0) into v_own_subtotal
  from public.commercial_line_items
  where commercial_event_id = p_commercial_event_id;

  if v_type = 'variation' then
    select coalesce(sum(d_ce.total_value), 0) into v_dayworks_subtotal
    from public.variation_dayworks vd
    join public.commercial_events d_ce on d_ce.id = vd.daywork_id
    where vd.variation_id = p_commercial_event_id;

    select markup_pct into v_markup_pct from public.variations where commercial_event_id = p_commercial_event_id;
    v_total := round((v_own_subtotal + v_dayworks_subtotal) * (1 + coalesce(v_markup_pct, 0) / 100), 2);
  else
    v_total := v_own_subtotal;
  end if;

  update public.commercial_events set total_value = v_total where id = p_commercial_event_id;
end;
$$;

-- Fires on every line-item write. Recomputes the line item's own parent
-- event, then — if that parent is a Daywork linked into one or more
-- Variations — recomputes each of those Variations too, since their
-- own total depends on the Daywork's total_value. variation_dayworks
-- only ever links a genuine daywork_id as the "daywork side" of the
-- join (enforced by its own FK above), so a Variation's recompute can
-- never in turn trigger another recompute of the same Daywork — the
-- dependency graph is one-directional by construction, not merely by
-- convention, so no recursion is possible.
create or replace function public.commercial_line_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_variation_id uuid;
begin
  v_event_id := coalesce(new.commercial_event_id, old.commercial_event_id);
  perform public.recompute_commercial_event_total(v_event_id);

  for v_variation_id in select variation_id from public.variation_dayworks where daywork_id = v_event_id loop
    perform public.recompute_commercial_event_total(v_variation_id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_commercial_line_items_after_write on public.commercial_line_items;
create trigger trg_commercial_line_items_after_write
  after insert or update or delete on public.commercial_line_items
  for each row execute function public.commercial_line_items_after_write();

-- Fires on link/unlink — the affected Variation's total must include
-- (or stop including) the linked Daywork's total_value immediately.
create or replace function public.variation_dayworks_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_commercial_event_total(coalesce(new.variation_id, old.variation_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_variation_dayworks_after_write on public.variation_dayworks;
create trigger trg_variation_dayworks_after_write
  after insert or delete on public.variation_dayworks
  for each row execute function public.variation_dayworks_after_write();

-- Fires when markup_pct itself changes (the only variations column the
-- total depends on).
create or replace function public.variations_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.markup_pct is distinct from old.markup_pct then
    perform public.recompute_commercial_event_total(new.commercial_event_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_variations_after_write on public.variations;
create trigger trg_variations_after_write
  after update on public.variations
  for each row execute function public.variations_after_write();

-- ─── commercial_event_totals — the authoritative pricing view ──────
-- Computes live from source rows every time it's queried — it has no
-- cache of its own to go stale, so it structurally cannot silently
-- disagree with commercial_line_items/variation_dayworks, unlike
-- commercial_events.total_value (a performance cache only). Anything
-- approval/signature-critical must read this view, never the cached
-- column.
create or replace view public.commercial_event_totals
with (security_invoker = true)
as
select
  ce.id as commercial_event_id,
  ce.type,
  coalesce(li.own_subtotal, 0) as own_subtotal,
  coalesce(dw.dayworks_subtotal, 0) as dayworks_subtotal,
  case when ce.type = 'variation' then coalesce(v.markup_pct, 0) else null end as markup_pct,
  case
    when ce.type = 'variation' then
      round((coalesce(li.own_subtotal, 0) + coalesce(dw.dayworks_subtotal, 0)) * (1 + coalesce(v.markup_pct, 0) / 100), 2)
    else
      coalesce(li.own_subtotal, 0)
  end as total
from public.commercial_events ce
left join public.variations v on v.commercial_event_id = ce.id
left join (
  select commercial_event_id, sum(line_total) as own_subtotal
  from public.commercial_line_items
  group by commercial_event_id
) li on li.commercial_event_id = ce.id
left join (
  select vd.variation_id, sum(d_ce.total_value) as dayworks_subtotal
  from public.variation_dayworks vd
  join public.commercial_events d_ce on d_ce.id = vd.daywork_id
  group by vd.variation_id
) dw on dw.variation_id = ce.id;

-- security_invoker = true (Postgres 15+) is REQUIRED here, not optional
-- — without it, a view created by an elevated-privilege role (which
-- every migration-applying role is, including Supabase's own migration
-- tooling) runs its underlying table access checks, RLS included, as
-- THAT role rather than the querying user, silently bypassing RLS on
-- commercial_events/commercial_line_items/variation_dayworks entirely
-- and leaking every organisation's Commercial data through this view's
-- auto-exposed PostgREST endpoint. Caught via Supabase's own security
-- advisor immediately after deploying this migration to production
-- (ERROR-level "Security Definer View" finding) — a genuine gap in an
-- earlier version of this comment, which incorrectly assumed views are
-- always invoker-security by default. Confirmed fixed: pg_class.
-- reloptions now shows security_invoker=true, and the advisor no
-- longer flags this view.

-- ─── Content hash for signatures ────────────────────────────────────
-- A deterministic digest of a commercial event's current line items and
-- its live (view-computed, never cached-column) total — used by
-- commercial_signatures.record_hash so a later dispute can prove
-- exactly what was signed off.
create or replace function public.commercial_event_hash(p_commercial_event_id uuid)
returns text
-- pgcrypto's digest() lands in different schemas depending on
-- environment: a fresh local/CI Postgres (tests/lib/mock_setup.sql's
-- plain `create extension if not exists "pgcrypto"`) puts it in
-- public, while Supabase-managed Postgres puts it in "extensions" —
-- confirmed empirically against the actual production project, not
-- assumed (`select extnamespace::regnamespace from pg_extension where
-- extname='pgcrypto'` returned "extensions" there). A schema listed in
-- search_path that doesn't exist is silently skipped by Postgres, so
-- listing both here resolves digest() correctly in both environments
-- without weakening this function's locked-down search_path in either.
language sql stable security definer set search_path = public, extensions
as $$
  select encode(
    digest(
      coalesce(
        (select string_agg(
          li.id::text || '|' || li.line_type || '|' || li.quantity::text || '|' || coalesce(li.rate::text, 'NULL') || '|' || coalesce(li.line_total::text, 'NULL'),
          ';' order by li.id
        ) from public.commercial_line_items li where li.commercial_event_id = p_commercial_event_id),
        ''
      ) || '|TOTAL:' || coalesce((select total::text from public.commercial_event_totals where commercial_event_id = p_commercial_event_id), '0'),
      'sha256'
    ),
    'hex'
  );
$$;

-- ─── commercial_evidence_links ──────────────────────────────────────
-- Points at EXISTING evidence rather than duplicating it. Postgres has
-- no native mechanism for a foreign key that targets a different table
-- depending on another column's value, so source_id is NOT a real FK —
-- this is a deliberate, explicit limitation (a fake/mislabelled FK
-- would be worse than an honest absence of one), and everything that
-- CAN be enforced at the database is: source_table is allow-listed,
-- source_id/commercial_event_id are both required, and the child-table
-- lock (draft/rejected only) applies exactly as it does for line items.
--
-- Scoped down from the approved architecture for Phase 0 specifically:
-- source_table lists only the four existing tables with a genuine,
-- stable row id an evidence link can point at today (snag_items,
-- inspection_finding_photos, documents, actions). weekly_report_photo
-- (a jsonb array element with no row id of its own) and
-- commercial_direct_upload (net-new evidence, not sourced from an
-- existing table at all) are intentionally NOT included — Phase 0
-- builds no evidence-linking UI of any kind, so inventing an identity
-- scheme for either now, with no consuming UI to validate it against,
-- risks getting it wrong. Flagged explicitly in the Phase 0 report as a
-- deviation, not a silent decision.
create table if not exists public.commercial_evidence_links (
  id uuid primary key default gen_random_uuid(),
  commercial_event_id uuid not null references public.commercial_events(id) on delete cascade,
  -- Denormalized, trigger-populated — same write_audit_log()
  -- compatibility reasoning as commercial_line_items.project_id above.
  project_id uuid not null references public.projects(id) on delete cascade,
  source_table text not null check (source_table in ('snag_items', 'inspection_finding_photos', 'documents', 'actions')),
  source_id uuid not null,
  caption text,
  is_primary boolean not null default false,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now()
);

create index if not exists commercial_evidence_links_event_idx on public.commercial_evidence_links (commercial_event_id);

drop trigger if exists trg_commercial_evidence_links_project_id on public.commercial_evidence_links;
create trigger trg_commercial_evidence_links_project_id
  before insert or update on public.commercial_evidence_links
  for each row execute function public.derive_project_id_from_commercial_event();

alter table public.commercial_evidence_links enable row level security;
drop policy if exists "commercial viewers read commercial_evidence_links" on public.commercial_evidence_links;
create policy "commercial viewers read commercial_evidence_links" on public.commercial_evidence_links for select using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_evidence_links.commercial_event_id and public.can_view_commercial(ce.project_id))
);
drop policy if exists "commercial contributors insert commercial_evidence_links" on public.commercial_evidence_links;
create policy "commercial contributors insert commercial_evidence_links" on public.commercial_evidence_links for insert with check (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_evidence_links.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);
drop policy if exists "commercial contributors update commercial_evidence_links" on public.commercial_evidence_links;
create policy "commercial contributors update commercial_evidence_links" on public.commercial_evidence_links for update using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_evidence_links.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);
drop policy if exists "commercial contributors delete commercial_evidence_links" on public.commercial_evidence_links;
create policy "commercial contributors delete commercial_evidence_links" on public.commercial_evidence_links for delete using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_evidence_links.commercial_event_id and public.can_edit_commercial(ce.project_id) and ce.status in ('draft', 'rejected'))
);

drop trigger if exists trg_audit_commercial_evidence_links on public.commercial_evidence_links;
create trigger trg_audit_commercial_evidence_links
  after insert or update or delete on public.commercial_evidence_links
  for each row execute function public.write_audit_log();

-- ─── commercial_signatures ──────────────────────────────────────────
-- Insert-only in the strictest sense available: RLS is enabled with
-- ONLY a select policy — there is no insert/update/delete policy for
-- ANY client role at all, mirroring audit_log's own "the only writer is
-- a trusted, security-definer trigger" pattern exactly. The sole writer
-- is commercial_events_before_write() below, inserting a signature row
-- as a side effect of a successful submitted/approved/rejected
-- transition — never a direct client insert, so a client can never
-- fabricate, backdate, or misattribute a signature.
--
-- signed_by_name is the signer's email — no display-name field exists
-- anywhere in this schema (identity is resolved via auth.users.email
-- throughout the app, e.g. getMemberEmailMap() in tracker/js/app.js),
-- so this matches existing convention rather than inventing a new one.
create table if not exists public.commercial_signatures (
  id uuid primary key default gen_random_uuid(),
  commercial_event_id uuid not null references public.commercial_events(id) on delete cascade,
  -- Denormalized — same write_audit_log() compatibility reasoning as
  -- commercial_line_items.project_id above. Populated directly by
  -- commercial_events_after_write() below (the only writer this table
  -- ever has), not by a separate trigger.
  project_id uuid not null references public.projects(id) on delete cascade,
  action text not null check (action in ('submitted', 'approved', 'rejected')),
  -- Deliberately NOT "on delete set null" — a signature must always
  -- name a real signer; if this ever needs to change to accommodate
  -- genuine account deletion, that is its own deliberate data-retention
  -- decision, not a default to fall into silently.
  signed_by_user_id uuid not null references auth.users(id),
  signed_by_name text not null,
  org_id uuid not null references public.organisations(id),
  statement_version text not null default 'v1',
  record_hash text,
  signed_at timestamptz not null default now()
);

create index if not exists commercial_signatures_event_idx on public.commercial_signatures (commercial_event_id);

alter table public.commercial_signatures enable row level security;
drop policy if exists "commercial viewers read commercial_signatures" on public.commercial_signatures;
create policy "commercial viewers read commercial_signatures" on public.commercial_signatures for select using (
  exists (select 1 from public.commercial_events ce where ce.id = commercial_signatures.commercial_event_id and public.can_view_commercial(ce.project_id))
);
-- No insert/update/delete policy for any client role — see comment above.

drop trigger if exists trg_audit_commercial_signatures on public.commercial_signatures;
create trigger trg_audit_commercial_signatures
  after insert or update or delete on public.commercial_signatures
  for each row execute function public.write_audit_log();

-- ─── Workflow enforcement: commercial_events_before_write() ────────
create or replace function public.valid_commercial_event_status_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_from, p_to) in (
    ('draft', 'submitted'),
    ('submitted', 'approved'),
    ('submitted', 'rejected'),
    ('rejected', 'draft')
  );
$$;

create or replace function public.commercial_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_plot_project_id uuid;
  v_signer_email text;
  v_hash text;
  v_next_seq integer;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'commercial_events.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'commercial_events.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the commercial event';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.status := 'draft'; -- an event can never be created pre-submitted/approved/rejected
    new.total_value := 0;
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    -- Auto-number the reference per project+type (e.g. DW-001, DW-002…)
    -- the moment it's needed by Phase 1's UI — mirrors
    -- set_snag_item_no()'s existing per-project max+1 convention
    -- exactly (sql/schema.sql, Priority 1), the established reference-
    -- numbering pattern in this codebase, not a new one. Never
    -- overwrites an explicitly-supplied reference.
    if new.reference is null then
      select coalesce(max(substring(reference from '(\d+)$')::int), 0) + 1
        into v_next_seq
        from public.commercial_events
        where project_id = new.project_id and type = new.type;
      new.reference := (case when new.type = 'daywork' then 'DW-' else 'VAR-' end) || lpad(v_next_seq::text, 3, '0');
    end if;

    return new;
  end if;

  -- identity fields are immutable regardless of payload
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.type := old.type; -- type never changes after creation
  new.org_id := old.org_id; -- re-derived above from project_id, but project_id itself never changes post-creation either (no policy allows editing it out from under an existing event)

  -- Absolute immutability once approved — nobody, including a project
  -- owner or org admin, may change anything at all. The only correction
  -- mechanism is a new row referencing this one via supersedes_id (no
  -- revision UI is built in this phase, but the guarantee holds from
  -- day one so nothing built on top of it later has to work around a
  -- gap that should never have existed).
  if old.status = 'approved' then
    raise exception 'This commercial event is approved and is immutable. Create a superseding record instead of editing it.';
  end if;

  if new.status <> old.status then
    if not public.valid_commercial_event_status_transition(old.status, new.status) then
      raise exception 'Invalid commercial event status transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'submitted' then
      if not public.can_submit_commercial(new.project_id) then
        raise exception 'You do not have permission to submit commercial events on this project';
      end if;
      -- Submitting must be a pure status flip — any content edit must
      -- already have been saved in a prior, separate update while still
      -- draft. Mirrors weekly_reports_before_write()'s own
      -- lock-on-transition comparison exactly.
      if (to_jsonb(new) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value']::text[]) then
        raise exception 'Save your changes first, then submit as a separate step.';
      end if;
      new.submitted_by := auth.uid();
      new.submitted_at := now();
      new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    elsif new.status = 'approved' then
      if not public.can_approve_commercial(new.project_id) then
        raise exception 'You do not have permission to approve commercial events on this project';
      end if;
      if old.created_by = auth.uid() then
        raise exception 'You cannot approve a commercial event you created yourself';
      end if;
      if (to_jsonb(new) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value']::text[]) then
        raise exception 'Approval must be a pure status change — no other field may change at the same time.';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();

    elsif new.status = 'rejected' then
      if not public.can_approve_commercial(new.project_id) then
        raise exception 'You do not have permission to reject commercial events on this project';
      end if;
      -- no self-rejection restriction, per the approved architecture
      if (to_jsonb(new) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value']::text[]) then
        raise exception 'Rejection must be a pure status change (plus an optional reason) — no other field may change at the same time.';
      end if;
      new.rejected_by := auth.uid();
      new.rejected_at := now();

    elsif new.status = 'draft' then
      -- reopening a rejected record
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;

  else
    -- No status change: an ordinary content edit is only permitted
    -- while the record is genuinely open (draft/rejected). total_value/
    -- updated_at are system-maintained (the recompute trigger) and are
    -- excluded from this comparison so a line-item-driven total refresh
    -- is never mistaken for a disallowed user content edit.
    if old.status not in ('draft', 'rejected') then
      if (to_jsonb(new) - array['total_value', 'updated_at']::text[])
         is distinct from
         (to_jsonb(old) - array['total_value', 'updated_at']::text[]) then
        raise exception 'This commercial event is % — its content is locked until it is rejected back to draft.', old.status;
      end if;
    else
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_commercial_events_before_write on public.commercial_events;
create trigger trg_commercial_events_before_write
  before insert or update on public.commercial_events
  for each row execute function public.commercial_events_before_write();

-- A second, AFTER trigger captures the signature — it needs new.id to
-- be the final, committed row, and needs to read the freshly-computed
-- hash/total, both of which are simplest to do once the row (and its
-- status) has actually landed, rather than folding it into the BEFORE
-- trigger above.
create or replace function public.commercial_events_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer_email text;
  v_action text;
begin
  if TG_OP <> 'UPDATE' or new.status = old.status then
    return new;
  end if;

  if new.status = 'submitted' then
    v_action := 'submitted';
  elsif new.status = 'approved' then
    v_action := 'approved';
  elsif new.status = 'rejected' then
    v_action := 'rejected';
  else
    return new; -- reopening to draft is not itself an attested action
  end if;

  select email into v_signer_email from auth.users where id = auth.uid();

  insert into public.commercial_signatures
    (commercial_event_id, project_id, action, signed_by_user_id, signed_by_name, org_id, statement_version, record_hash)
  values
    (new.id, new.project_id, v_action, auth.uid(), coalesce(v_signer_email, 'unknown'), new.org_id, 'v1', public.commercial_event_hash(new.id));

  return new;
end;
$$;

drop trigger if exists trg_commercial_events_after_write on public.commercial_events;
create trigger trg_commercial_events_after_write
  after update on public.commercial_events
  for each row execute function public.commercial_events_after_write();

-- ─── v41 ADDITIONS: Commercial Module — Phase 1 (Daywork UI enablement) ──
-- Two small, additive grants/behaviours needed only because a real
-- frontend now exists on top of the Phase 0 foundation — no table
-- structure changes, no RLS/workflow/permission logic changes.
--
-- 1. project_module_role() already existed (Phase 0) as the internal
--    building block RLS policies compose from, but had no client EXECUTE
--    grant — nothing needed to call it directly before now. The UI needs
--    to ask "what is my OWN Commercial role on this project?" to decide
--    what to render (mirroring the exact precedent get_my_role() already
--    set for the equivalent general-project-role question). This grants
--    read of the caller's own role only — auth.uid() is baked into the
--    function itself, so it can never be used to query anyone else's
--    role. It grants no new capability: RLS was already the real
--    enforcement boundary and remains completely unchanged.
grant execute on function public.project_module_role(uuid, text) to authenticated;

-- ─── v42 ADDITIONS: Organisation Onboarding & Membership Requests ───────
-- Phase 0 of the Account & Organisation Architecture work (see the
-- read-only audit this migration implements). Two independent additions:
--
--   1. organisations.type — a classification column for onboarding/
--      defaults/analytics ONLY. Deliberately never read by any RLS
--      policy or permission function anywhere in this file — grep for
--      "organisations.type" or ".type" against is_org_member/is_org_admin/
--      is_project_*/can_*_commercial below to confirm none of them
--      reference it, now or after any future edit.
--
--   2. organisation_membership_requests — a NEW, SEPARATE table for the
--      "request to join an existing organisation" workflow, deliberately
--      NOT folded into organisation_members. organisation_members keeps
--      its existing meaning exactly as before this migration ("this row
--      existing means this user has real access") — every predicate that
--      already reads it (is_org_member, is_org_admin, and transitively
--      is_project_member/is_project_owner/is_project_editor) is UNCHANGED
--      by this migration, needs no new "and status = 'approved'" clause,
--      and every existing organisation/project a user already had access
--      to keeps working exactly as it did. A pending or rejected request
--      never appears in organisation_members at all — only
--      approve_organisation_membership() below ever inserts into it, and
--      only once.
--
-- The existing project invite_code/snagging_invite_code flow
-- (regenerate_invite_code/join_project_by_invite, "v1"/v26 above) is
-- UNCHANGED — it remains an instant, owner-issued, project-scoped grant
-- (which also still auto-enrols the joiner into that project's
-- organisation, exactly as before). Organisation join REQUESTS below are
-- a second, independent route into an organisation — self-service search
-- + request, gated by admin approval — never routed through invite codes
-- and never routing invite codes through it.

alter table public.organisations
  add column if not exists type text not null default 'other'
  check (type in ('main_contractor', 'subcontractor', 'developer_client', 'consultant', 'supplier', 'other'));

create table if not exists public.organisation_membership_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  updated_at timestamptz not null default now()
);

-- The actual "prevent duplicate simultaneous requests" enforcement — a
-- partial unique index, not just an application-level check in
-- request_organisation_membership() below (which also checks, for a
-- friendly error message, but the index is what's actually relied on
-- under concurrent calls). Deliberately partial (WHERE status='pending')
-- rather than a plain unique(organisation_id, user_id): a user must be
-- able to have MANY historical rejected/approved rows for the same
-- organisation over time (e.g. rejected, then genuinely re-applies
-- later) — only one row may ever be pending at once for a given
-- (organisation, user) pair.
create unique index if not exists organisation_membership_requests_pending_unique
  on public.organisation_membership_requests (organisation_id, user_id)
  where status = 'pending';

create index if not exists organisation_membership_requests_org_status_idx
  on public.organisation_membership_requests (organisation_id, status);
create index if not exists organisation_membership_requests_user_idx
  on public.organisation_membership_requests (user_id);

alter table public.organisation_membership_requests enable row level security;

-- A requester may read their own request rows (any status — they need to
-- see "pending"/"rejected" too, not just once approved); an organisation
-- admin may read every request row FOR THEIR OWN organisation, pending or
-- otherwise. An ordinary (non-admin) member of the target organisation
-- gets neither of those unless they're also the requester — approval
-- authority (and visibility into who else has applied) stays admin-only,
-- exactly as specified.
drop policy if exists "requester or org admin read organisation_membership_requests" on public.organisation_membership_requests;
create policy "requester or org admin read organisation_membership_requests" on public.organisation_membership_requests
  for select using (user_id = auth.uid() or public.is_org_admin(organisation_id));

-- No insert/update/delete policy for regular clients — RLS is enabled
-- with zero write policies, so Postgres denies direct writes to every
-- client role by default (the same "enabled, unpolicied = default-
-- denied" pattern as audit_log and module_roles above). Every write to
-- this table happens exclusively through the four security-definer
-- functions below. This is what makes the approval boundary real rather
-- than UI-only: a client cannot forge an 'approved' status, a
-- reviewed_by, or a reviewed_at by writing the row directly — only
-- approve_organisation_membership()/reject_organisation_membership() can
-- ever set those columns, and both independently re-check admin
-- authority server-side before doing so.

-- Lets a non-member authenticated user find an organisation to request
-- membership of, without weakening "members read organisations" (still
-- member-only, unchanged) into a public/any-authenticated-read policy.
-- Returns only the three fields a picker UI needs — never members,
-- projects, settings, or any other organisation data. A query shorter
-- than 2 characters returns nothing (fail closed against "" effectively
-- listing every organisation in the system); results are capped at 25.
create or replace function public.search_organisations(q text)
returns table (id uuid, name text, type text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.type
  from public.organisations o
  where q is not null
    and length(trim(q)) >= 2
    and o.name ilike '%' || trim(q) || '%'
  order by o.name
  limit 25;
$$;
grant execute on function public.search_organisations(text) to authenticated;

-- The independent-use signup path ("Create my own organisation"). Unlike
-- ensure_organisation() (unchanged, still used by dashboard.html/
-- settings.html/existing tests for the "resolve or lazily create THE
-- org" case), this ALWAYS creates a brand-new organisation and never
-- reuses an existing one — a user may deliberately want a second, third,
-- etc. organisation (see the audit's multi-org requirement), so "already
-- has one" must never short-circuit this. No approval step: the caller
-- becomes that organisation's sole admin atomically, in the same
-- transaction as the organisation row itself.
create or replace function public.create_organisation(p_name text, p_type text default 'other')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
  v_type text := coalesce(p_type, 'other');
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Organisation name is required';
  end if;
  if v_type not in ('main_contractor', 'subcontractor', 'developer_client', 'consultant', 'supplier', 'other') then
    v_type := 'other';
  end if;

  insert into public.organisations (name, type) values (trim(p_name), v_type) returning id into new_org;
  insert into public.organisation_members (org_id, user_id, role) values (new_org, auth.uid(), 'admin');

  return new_org;
end;
$$;
grant execute on function public.create_organisation(text, text) to authenticated;

-- The "Join an existing organisation" signup path. Grants nothing by
-- itself — only ever creates a pending request row. Safe against direct
-- API/RPC manipulation: the organisation must genuinely exist, an
-- already-approved member is refused outright (so this can never be
-- (ab)used to re-confirm/duplicate an existing membership), and a second
-- call while one request is already pending returns the SAME request id
-- rather than erroring or creating a duplicate (idempotent from the
-- caller's point of view; the partial unique index above is what
-- actually guarantees only one pending row can ever exist even under a
-- race between two concurrent calls). A previously rejected request
-- does NOT block a fresh one — this inserts a new row, starting at
-- 'pending' again, never resurrecting or auto-approving the old one.
create or replace function public.request_organisation_membership(p_organisation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'Organisation not found';
  end if;

  if public.is_org_member(p_organisation_id) then
    raise exception 'You are already a member of this organisation';
  end if;

  insert into public.organisation_membership_requests (organisation_id, user_id, status)
  values (p_organisation_id, auth.uid(), 'pending')
  on conflict (organisation_id, user_id) where status = 'pending' do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select id into v_request_id
    from public.organisation_membership_requests
    where organisation_id = p_organisation_id and user_id = auth.uid() and status = 'pending';
  end if;

  return v_request_id;
end;
$$;
grant execute on function public.request_organisation_membership(uuid) to authenticated;

-- Approval is atomic: the new organisation_members row and the request's
-- own status flip happen inside the same function invocation (therefore
-- the same statement-level transaction) — there is no window in which a
-- caller could observe one without the other, and if either half were to
-- fail the whole call rolls back, never leaving an approved-looking
-- request with no real membership or a real membership with no approved
-- record. Authority is re-checked here, server-side, every time — never
-- inferred from the UI even having shown an approve button. Deliberately
-- SELECTs the request (not UPDATE ... WHERE status='pending' as the
-- first step) so an unauthorized caller is rejected BEFORE anything is
-- written, not after a write is attempted and rolled back.
create or replace function public.approve_organisation_membership(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select organisation_id, user_id, status into v_req
  from public.organisation_membership_requests
  where id = p_request_id;

  if v_req is null then
    raise exception 'Membership request not found';
  end if;

  if not public.is_org_admin(v_req.organisation_id) then
    raise exception 'Only an organisation admin can approve membership requests';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'This request is no longer pending';
  end if;

  insert into public.organisation_members (org_id, user_id, role)
  values (v_req.organisation_id, v_req.user_id, 'member')
  on conflict (org_id, user_id) do nothing;

  update public.organisation_membership_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  where id = p_request_id and status = 'pending';
end;
$$;
grant execute on function public.approve_organisation_membership(uuid) to authenticated;

-- Mirrors approve_organisation_membership() exactly, minus the
-- organisation_members insert — a rejection never grants access under
-- any circumstance.
create or replace function public.reject_organisation_membership(p_request_id uuid, p_rejection_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select organisation_id, status into v_req
  from public.organisation_membership_requests
  where id = p_request_id;

  if v_req is null then
    raise exception 'Membership request not found';
  end if;

  if not public.is_org_admin(v_req.organisation_id) then
    raise exception 'Only an organisation admin can reject membership requests';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'This request is no longer pending';
  end if;

  update public.organisation_membership_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), rejection_reason = p_rejection_reason, updated_at = now()
  where id = p_request_id and status = 'pending';
end;
$$;
grant execute on function public.reject_organisation_membership(uuid, text) to authenticated;

-- Lets a requester see their own requests (any status) WITH the
-- organisation's name attached — the base table's own RLS policy above
-- already lets them select their own rows directly, but they can't join
-- to organisations for one they're not yet a member of (that table stays
-- member-only-readable, unchanged). Strictly scoped to auth.uid() inside
-- the function body — there is no parameter through which a caller could
-- ask for anyone else's requests.
create or replace function public.get_my_organisation_requests()
returns table (id uuid, organisation_id uuid, organisation_name text, status text, requested_at timestamptz, reviewed_at timestamptz, rejection_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.organisation_id, o.name, r.status, r.requested_at, r.reviewed_at, r.rejection_reason
  from public.organisation_membership_requests r
  join public.organisations o on o.id = r.organisation_id
  where r.user_id = auth.uid()
  order by r.requested_at desc;
$$;
grant execute on function public.get_my_organisation_requests() to authenticated;

-- Organisation-level counterpart to the existing get_project_members() —
-- same shape, same reasoning (clients can't query auth.users directly).
-- Scoped to members of that org only (any role, not admin-only — viewing
-- who else is in your own organisation is not itself sensitive, same
-- precedent as get_project_members()'s own project-member-level scope).
create or replace function public.get_organisation_members(p_org_id uuid)
returns table (member_id uuid, user_id uuid, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select om.id, om.user_id, u.email, om.role, om.created_at
  from public.organisation_members om
  join auth.users u on u.id = om.user_id
  where om.org_id = p_org_id
    and public.is_org_member(p_org_id)
  order by (om.role = 'admin') desc, u.email;
$$;
grant execute on function public.get_organisation_members(uuid) to authenticated;

-- Admin-only counterpart for the pending-requests inbox — deliberately
-- gated on is_org_admin(), not is_org_member(): an ordinary member must
-- not see who else has applied to join their organisation (the base
-- table's own RLS policy above enforces the same boundary independently;
-- this function is only for attaching the requester's email, which
-- otherwise isn't joinable client-side).
create or replace function public.get_organisation_membership_requests(p_org_id uuid, p_status text default 'pending')
returns table (id uuid, organisation_id uuid, user_id uuid, email text, status text, requested_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, rejection_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.organisation_id, r.user_id, u.email, r.status, r.requested_at, r.reviewed_at, r.reviewed_by, r.rejection_reason
  from public.organisation_membership_requests r
  join auth.users u on u.id = r.user_id
  where r.organisation_id = p_org_id
    and public.is_org_admin(p_org_id)
    and (p_status is null or r.status = p_status)
  order by r.requested_at desc;
$$;
grant execute on function public.get_organisation_membership_requests(uuid, text) to authenticated;

-- ─── v43 ADDITIONS: restrict the v42 RPCs to authenticated only ────────
-- PostgreSQL grants EXECUTE on a newly created function to PUBLIC by
-- default, which every one of the 8 security-definer functions added in
-- v42 inherited alongside their explicit "grant ... to authenticated"
-- (that grant was, and remains, correct — it just wasn't the ONLY grant
-- in effect). Review flagged this: it meant a fully anonymous caller
-- (Supabase's `anon` role — no session at all, not merely an
-- authenticated session with no identity) could invoke e.g.
-- search_organisations(), despite the brief specifying "a non-member
-- AUTHENTICATED user."
--
-- Scope is deliberately narrow: only these 8 v42 functions are touched.
-- The same PUBLIC-default characteristic exists on every one of this
-- schema's other ~47 pre-existing security-definer functions too — left
-- alone here on purpose (not a schema-wide cleanup; see the Phase 0
-- report's Known Issues, which already flagged this as a pre-existing,
-- accepted pattern this migration does not attempt to remediate
-- everywhere).
revoke execute on function public.search_organisations(text) from public;
revoke execute on function public.create_organisation(text, text) from public;
revoke execute on function public.request_organisation_membership(uuid) from public;
revoke execute on function public.approve_organisation_membership(uuid) from public;
revoke execute on function public.reject_organisation_membership(uuid, text) from public;
revoke execute on function public.get_my_organisation_requests() from public;
revoke execute on function public.get_organisation_members(uuid) from public;
revoke execute on function public.get_organisation_membership_requests(uuid, text) from public;

-- Belt and braces: Supabase provisions an `anon` role for every project
-- (the actual role a genuinely unauthenticated REST API request runs
-- as), and some Supabase projects also carry an explicit default-
-- privilege grant of EXECUTE to `anon` on newly created public-schema
-- functions, independent of the PUBLIC pseudo-role revoked above. This
-- statement is a no-op wherever no such grant exists (REVOKE never
-- errors when the privilege being removed isn't present) and is the
-- decisive fix wherever it does.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.search_organisations(text) from anon;
    revoke execute on function public.create_organisation(text, text) from anon;
    revoke execute on function public.request_organisation_membership(uuid) from anon;
    revoke execute on function public.approve_organisation_membership(uuid) from anon;
    revoke execute on function public.reject_organisation_membership(uuid, text) from anon;
    revoke execute on function public.get_my_organisation_requests() from anon;
    revoke execute on function public.get_organisation_members(uuid) from anon;
    revoke execute on function public.get_organisation_membership_requests(uuid, text) from anon;
  end if;
end $$;

-- ─── v44 ADDITIONS: Toolbox Talks ────────────────────────────────────
-- A new module, following the exact architecture already established by
-- Commercial (Phase 0-2) and Documents: module_roles/project_module_roles
-- for permissions (no new permission system), a parent+immutable-version
-- pair modelled directly on documents/document_revisions for the
-- template library, a signature/audit pattern modelled on
-- commercial_signatures/write_audit_log, and child-locking RLS modelled
-- on commercial_line_items. No changes to organisations, projects,
-- module_roles' existing rows, commercial_items, or any Commercial table.
--
-- Template scope: toolbox_talk_templates.org_id is NULLABLE.
--   - NULL = a system-provided template (the imported standard library).
--     Readable by every authenticated user (mirrors module_roles' own
--     "authenticated read" policy — the only existing precedent in this
--     schema for non-org-scoped, globally-readable reference data) but
--     writable by NOBODY through the client — only the import process,
--     which runs with elevated (RLS-bypassing) database access, ever
--     creates one. This is what makes "organisations can use the
--     standard talks without being able to modify another organisation's
--     (or the system's) templates" true by construction, not by policy
--     discipline alone.
--   - A specific org_id = that organisation's own template, editable only
--     by that organisation's authorised users, invisible to every other
--     organisation. Two completely independent scopes sharing one table,
--     exactly the way commercial_events already shares one table across
--     variation/daywork via a `type` discriminator.
--
-- Versioning: toolbox_talk_template_versions rows are immutable once
-- created (no update/delete policy at all, same as document_revisions),
-- and every delivered toolbox_talks row snapshots the exact version
-- content at start time — never a live reference to "whatever the
-- template currently says" — so editing a template can never alter a
-- historical completed talk.

insert into public.module_roles (module, role, sort_order) values
  ('toolbox_talks', 'viewer', 1),
  ('toolbox_talks', 'contributor', 2),
  ('toolbox_talks', 'editor', 3)
on conflict (module, role) do nothing;

create table if not exists public.toolbox_talk_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organisations(id),
  title text not null,
  description text,
  source_filename text,
  source_reference text,
  is_active boolean not null default true,
  -- FK added below, once toolbox_talk_template_versions exists (the two
  -- tables reference each other, same ordering reason as documents/
  -- document_revisions.current_revision_id above).
  current_version_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.toolbox_talk_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.toolbox_talk_templates(id) on delete cascade,
  version_number integer not null,
  -- Structured content — sections vary slightly by talk (see the
  -- imported library's own shape: introduction, key_message, key_points,
  -- site_observations {good_practice, warning_signs}, discussion_
  -- questions, key_takeaways, pre_task_checks, duration_label, audience)
  -- but every talk's content is fundamentally "a handful of named
  -- sections", which is what jsonb is for here — not a schema-avoidance
  -- shortcut. There is deliberately no per-section relational table: a
  -- talk's sections are never independently queried, filtered, or
  -- joined against anywhere in this feature.
  content jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version_number)
);

alter table public.toolbox_talk_templates drop constraint if exists toolbox_talk_templates_current_version_id_fkey;
alter table public.toolbox_talk_templates add constraint toolbox_talk_templates_current_version_id_fkey
  foreign key (current_version_id) references public.toolbox_talk_template_versions(id) on delete set null;

create index if not exists toolbox_talk_templates_org_idx on public.toolbox_talk_templates (org_id);
create index if not exists toolbox_talk_template_versions_template_idx on public.toolbox_talk_template_versions (template_id, version_number);

-- Org-level authority to maintain the template library: either the
-- organisation's admin (mirrors how is_org_admin() already governs the
-- organisation's own settings/name), OR anyone holding the 'editor'
-- toolbox_talks module role on at least one of the organisation's
-- projects (project_module_roles is inherently per-project, so this
-- composes it up to org level rather than inventing a separate org-level
-- grant table — an org admin can delegate library-editing rights to a
-- specific trusted person via the exact same owner-grants-module-roles
-- mechanism Commercial already uses, without making them org admin).
create or replace function public.can_edit_toolbox_talk_template_library(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_admin(p_org_id) or exists (
    select 1
    from public.project_module_roles pmr
    join public.projects p on p.id = pmr.project_id
    where p.org_id = p_org_id
      and pmr.user_id = auth.uid()
      and pmr.module = 'toolbox_talks'
      and pmr.role = 'editor'
      and public.is_project_member(p.id)
  );
$$;
revoke execute on function public.can_edit_toolbox_talk_template_library(uuid) from public;
grant execute on function public.can_edit_toolbox_talk_template_library(uuid) to authenticated;
-- Belt and braces, same as v42's own organisation RPCs (see the "Phase 0
-- Cleanup" migration above): some Supabase projects carry a default-
-- privilege grant of EXECUTE to `anon` on new public-schema functions,
-- independent of the PUBLIC pseudo-role revoked above. This is a no-op
-- wherever that grant doesn't exist, and the decisive fix wherever it does.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.can_edit_toolbox_talk_template_library(uuid) from anon;
  end if;
end $$;

alter table public.toolbox_talk_templates enable row level security;
drop policy if exists "members read toolbox_talk_templates" on public.toolbox_talk_templates;
create policy "members read toolbox_talk_templates" on public.toolbox_talk_templates for select using (
  (org_id is null and auth.role() = 'authenticated') or public.is_org_member(org_id)
);
drop policy if exists "editors insert toolbox_talk_templates" on public.toolbox_talk_templates;
create policy "editors insert toolbox_talk_templates" on public.toolbox_talk_templates for insert with check (
  org_id is not null and public.can_edit_toolbox_talk_template_library(org_id)
);
drop policy if exists "editors update toolbox_talk_templates" on public.toolbox_talk_templates;
create policy "editors update toolbox_talk_templates" on public.toolbox_talk_templates for update using (
  org_id is not null and public.can_edit_toolbox_talk_template_library(org_id)
) with check (
  org_id is not null and public.can_edit_toolbox_talk_template_library(org_id)
);
-- No delete policy — templates are retired via is_active = false, never
-- deleted (matches documents' own "archive, never delete" convention).
-- System templates (org_id null) have no insert/update policy at all —
-- only the import process, running with RLS-bypassing access, ever
-- writes one.

drop policy if exists "members read toolbox_talk_template_versions" on public.toolbox_talk_template_versions;
alter table public.toolbox_talk_template_versions enable row level security;
create policy "members read toolbox_talk_template_versions" on public.toolbox_talk_template_versions for select using (
  exists (
    select 1 from public.toolbox_talk_templates t
    where t.id = toolbox_talk_template_versions.template_id
      and ((t.org_id is null and auth.role() = 'authenticated') or public.is_org_member(t.org_id))
  )
);
drop policy if exists "editors insert toolbox_talk_template_versions" on public.toolbox_talk_template_versions;
create policy "editors insert toolbox_talk_template_versions" on public.toolbox_talk_template_versions for insert with check (
  exists (
    select 1 from public.toolbox_talk_templates t
    where t.id = toolbox_talk_template_versions.template_id
      and t.org_id is not null
      and public.can_edit_toolbox_talk_template_library(t.org_id)
  )
);
-- No update/delete policy — versions are immutable the moment they're
-- created, exactly like document_revisions.

create or replace function public.toolbox_talk_templates_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();
    new.current_version_id := null; -- always starts empty; set by the first version's own insert
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.org_id := old.org_id; -- a template never moves between organisations (or in/out of system scope)
  new.updated_by := auth.uid();
  new.updated_at := now();

  if coalesce(current_setting('app.allow_toolbox_talk_current_version_change', true), '') <> 'on' then
    new.current_version_id := old.current_version_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_toolbox_talk_templates_before_write on public.toolbox_talk_templates;
create trigger trg_toolbox_talk_templates_before_write
  before insert or update on public.toolbox_talk_templates
  for each row execute function public.toolbox_talk_templates_before_write();

create or replace function public.toolbox_talk_template_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  new.created_by := auth.uid();
  new.created_at := now();
  if new.version_number is null then
    select coalesce(max(version_number), 0) + 1 into v_next
      from public.toolbox_talk_template_versions where template_id = new.template_id;
    new.version_number := v_next;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_toolbox_talk_template_versions_before_insert on public.toolbox_talk_template_versions;
create trigger trg_toolbox_talk_template_versions_before_insert
  before insert on public.toolbox_talk_template_versions
  for each row execute function public.toolbox_talk_template_versions_before_insert();

-- Promotes the new version to be its template's "current" one — same
-- session-local-flag idiom as document_revisions_after_insert(), so the
-- templates_before_write() guard above lets this one specific,
-- internally-triggered UPDATE through without opening current_version_id
-- up to ordinary client writes.
create or replace function public.toolbox_talk_template_versions_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.allow_toolbox_talk_current_version_change', 'on', true);
  update public.toolbox_talk_templates set current_version_id = new.id where id = new.template_id;
  perform set_config('app.allow_toolbox_talk_current_version_change', 'off', true);
  return new;
end;
$$;

drop trigger if exists trg_toolbox_talk_template_versions_after_insert on public.toolbox_talk_template_versions;
create trigger trg_toolbox_talk_template_versions_after_insert
  after insert on public.toolbox_talk_template_versions
  for each row execute function public.toolbox_talk_template_versions_after_insert();

-- ─── Project-level permissions: delivering/attending talks ─────────
create or replace function public.can_view_toolbox_talks(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'toolbox_talks') in ('viewer', 'contributor', 'editor');
$$;

create or replace function public.can_edit_toolbox_talks(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.project_module_role(p_project_id, 'toolbox_talks') in ('contributor', 'editor');
$$;
-- Deliberately no explicit grant/revoke on these two — they're used only
-- inside RLS policies below, the same as can_view_commercial/
-- can_edit_commercial (Phase 0), which have never needed a direct client
-- grant either.

-- ─── toolbox_talks — a delivered talk (the workflow's core record) ──
create table if not exists public.toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid not null references public.toolbox_talk_templates(id),
  template_version_id uuid not null references public.toolbox_talk_template_versions(id),
  title text not null,
  -- The actual, server-populated copy of the version's content at the
  -- moment this talk was started — see toolbox_talks_before_write()
  -- below. Never client-supplied: a client could otherwise claim to have
  -- delivered content that was never really in the referenced version.
  content_snapshot jsonb not null,
  source_filename text,
  -- Site-specific additions (today's conditions, extra hazards, notes) —
  -- kept in its OWN column, deliberately separate from content_snapshot,
  -- so the standard template content always stays identifiable as
  -- exactly what was published, never silently merged with ad hoc notes.
  site_notes text,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  delivered_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists toolbox_talks_project_status_idx on public.toolbox_talks (project_id, status);
create index if not exists toolbox_talks_org_idx on public.toolbox_talks (org_id);

alter table public.toolbox_talks enable row level security;
drop policy if exists "toolbox talk viewers read toolbox_talks" on public.toolbox_talks;
create policy "toolbox talk viewers read toolbox_talks" on public.toolbox_talks for select using (
  public.can_view_toolbox_talks(project_id)
);
drop policy if exists "toolbox talk contributors insert toolbox_talks" on public.toolbox_talks;
create policy "toolbox talk contributors insert toolbox_talks" on public.toolbox_talks for insert with check (
  public.can_edit_toolbox_talks(project_id)
);
drop policy if exists "toolbox talk contributors update toolbox_talks" on public.toolbox_talks;
create policy "toolbox talk contributors update toolbox_talks" on public.toolbox_talks for update using (
  public.can_edit_toolbox_talks(project_id)
);
-- No delete policy — a started talk always leaves a record, even if
-- cancelled.

create or replace function public.valid_toolbox_talk_status_transition(p_from text, p_to text)
returns boolean
language sql immutable set search_path = public
as $$
  select (p_from, p_to) in (('in_progress', 'completed'), ('in_progress', 'cancelled'));
$$;

-- The workflow's real authority. Two things matter most here:
--   1. content_snapshot is ALWAYS taken server-side from the real
--      template_version_id row, never from client input — closing the
--      same class of gap Commercial Phase 2 found and fixed for
--      variation_dayworks (a SECURITY DEFINER trigger reaching across a
--      table whose own RLS the trigger itself bypasses MUST re-implement
--      that table's boundary check, not rely on RLS having already run).
--   2. That same lookup is where the cross-organisation boundary is
--      enforced: the referenced template must be either system-provided
--      (org_id is null) or belong to the SAME organisation as the
--      project the talk is being started on — otherwise a project in
--      Org A could start a talk against Org B's private template id
--      (if guessed/leaked) and have its full content silently copied in.
create or replace function public.toolbox_talks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_version record;
  v_attendee_count integer;
  v_unresolved integer;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'toolbox_talks.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if TG_OP = 'INSERT' then
    select tv.template_id, tv.content, t.title, t.source_filename, t.org_id as template_org_id
      into v_version
      from public.toolbox_talk_template_versions tv
      join public.toolbox_talk_templates t on t.id = tv.template_id
      where tv.id = new.template_version_id;

    if v_version is null then
      raise exception 'toolbox_talks.template_version_id must reference an existing template version';
    end if;
    if v_version.template_id <> new.template_id then
      raise exception 'template_version_id must belong to the specified template_id';
    end if;
    if v_version.template_org_id is not null and v_version.template_org_id <> v_org_id then
      raise exception 'This template does not belong to your organisation';
    end if;

    new.content_snapshot := v_version.content;
    new.title := coalesce(nullif(trim(new.title), ''), v_version.title);
    new.source_filename := v_version.source_filename;
    new.delivered_by := auth.uid();
    new.started_at := now();
    new.status := 'in_progress';
    new.completed_by := null; new.completed_at := null;
    new.cancelled_by := null; new.cancelled_at := null; new.cancellation_reason := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE path: identity/snapshot fields are permanently fixed from
  -- the moment the talk is started.
  new.created_at := old.created_at;
  new.org_id := old.org_id;
  new.project_id := old.project_id;
  new.template_id := old.template_id;
  new.template_version_id := old.template_version_id;
  new.content_snapshot := old.content_snapshot;
  new.source_filename := old.source_filename;
  new.delivered_by := old.delivered_by;
  new.started_at := old.started_at;
  new.updated_at := now();

  if old.status <> 'in_progress' then
    raise exception 'This toolbox talk is % and is immutable.', old.status;
  end if;

  if new.status <> old.status then
    if not public.valid_toolbox_talk_status_transition(old.status, new.status) then
      raise exception 'Invalid toolbox talk status transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'completed' then
      select count(*) into v_attendee_count from public.toolbox_talk_attendees where toolbox_talk_id = new.id;
      if v_attendee_count = 0 then
        raise exception 'Add at least one attendee before completing this talk.';
      end if;
      select count(*) into v_unresolved
        from public.toolbox_talk_attendees
        where toolbox_talk_id = new.id and signed_at is null and exception_reason is null;
      if v_unresolved > 0 then
        raise exception '% attendee(s) have not yet signed or been recorded as an exception.', v_unresolved;
      end if;
      new.completed_by := auth.uid();
      new.completed_at := now();
    elsif new.status = 'cancelled' then
      if new.cancellation_reason is null or length(trim(new.cancellation_reason)) = 0 then
        raise exception 'A cancellation reason is required to cancel a toolbox talk.';
      end if;
      new.cancelled_by := auth.uid();
      new.cancelled_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_toolbox_talks_before_write on public.toolbox_talks;
create trigger trg_toolbox_talks_before_write
  before insert or update on public.toolbox_talks
  for each row execute function public.toolbox_talks_before_write();

-- ─── toolbox_talk_attendees — one row per attendee, never a name list ──
create table if not exists public.toolbox_talk_attendees (
  id uuid primary key default gen_random_uuid(),
  toolbox_talk_id uuid not null references public.toolbox_talks(id) on delete cascade,
  -- Denormalized, trigger-populated — same write_audit_log()
  -- compatibility reasoning as commercial_line_items.project_id.
  project_id uuid not null references public.projects(id) on delete cascade,
  -- An attendee's own platform account, where they have one — never
  -- required (see brief: attendance must not require an account).
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  company text,
  attendance_status text not null default 'confirmed' check (attendance_status in ('confirmed', 'left_early', 'excused')),
  signed_at timestamptz,
  signature_data text,
  signature_typed_name text,
  -- Who actually performed the sign action (in practice, almost always
  -- the deliverer's own session — the phone is handed around and they
  -- tap submit for each attendee in turn, exactly as the brief's own
  -- workflow describes) — distinct from user_id, which is the
  -- attendee's own identity if they happen to have one.
  signed_by uuid references auth.users(id) on delete set null,
  exception_reason text,
  exception_recorded_by uuid references auth.users(id) on delete set null,
  exception_at timestamptz,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (signed_at is null or exception_reason is null)
);

create index if not exists toolbox_talk_attendees_talk_idx on public.toolbox_talk_attendees (toolbox_talk_id);
create index if not exists toolbox_talk_attendees_project_idx on public.toolbox_talk_attendees (project_id);

alter table public.toolbox_talk_attendees enable row level security;
drop policy if exists "toolbox talk viewers read toolbox_talk_attendees" on public.toolbox_talk_attendees;
create policy "toolbox talk viewers read toolbox_talk_attendees" on public.toolbox_talk_attendees for select using (
  exists (select 1 from public.toolbox_talks tt where tt.id = toolbox_talk_attendees.toolbox_talk_id and public.can_view_toolbox_talks(tt.project_id))
);
-- Every write policy below independently re-checks the PARENT talk's
-- live status (in_progress only) on every call — the actual child-lock
-- enforcement, mirroring commercial_line_items' own write policies
-- exactly (a parent-side trigger alone cannot protect a child table a
-- client can still write to directly).
drop policy if exists "toolbox talk contributors insert toolbox_talk_attendees" on public.toolbox_talk_attendees;
create policy "toolbox talk contributors insert toolbox_talk_attendees" on public.toolbox_talk_attendees for insert with check (
  exists (select 1 from public.toolbox_talks tt where tt.id = toolbox_talk_attendees.toolbox_talk_id and public.can_edit_toolbox_talks(tt.project_id) and tt.status = 'in_progress')
);
drop policy if exists "toolbox talk contributors update toolbox_talk_attendees" on public.toolbox_talk_attendees;
create policy "toolbox talk contributors update toolbox_talk_attendees" on public.toolbox_talk_attendees for update using (
  exists (select 1 from public.toolbox_talks tt where tt.id = toolbox_talk_attendees.toolbox_talk_id and public.can_edit_toolbox_talks(tt.project_id) and tt.status = 'in_progress')
);
drop policy if exists "toolbox talk contributors delete toolbox_talk_attendees" on public.toolbox_talk_attendees;
create policy "toolbox talk contributors delete toolbox_talk_attendees" on public.toolbox_talk_attendees for delete using (
  exists (select 1 from public.toolbox_talks tt where tt.id = toolbox_talk_attendees.toolbox_talk_id and public.can_edit_toolbox_talks(tt.project_id) and tt.status = 'in_progress')
  and signed_at is null and exception_reason is null
);
-- Deleting is only ever possible before an attendee has signed or been
-- excepted — once either of those exists, the row is protected even
-- from deletion, matching "once signatures have started, protect the
-- integrity of existing attendance/signature records" exactly.

create or replace function public.toolbox_talk_attendees_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status text;
begin
  select project_id, status into v_project_id, v_status from public.toolbox_talks where id = new.toolbox_talk_id;
  if v_project_id is null then
    raise exception 'toolbox_talk_attendees.toolbox_talk_id must reference an existing toolbox_talks row';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'Attendees cannot be added to a % toolbox talk.', v_status;
  end if;
  new.project_id := v_project_id;
  new.added_by := auth.uid();
  new.created_at := now();
  new.signed_at := null; new.signature_data := null; new.signature_typed_name := null; new.signed_by := null;
  new.exception_reason := null; new.exception_recorded_by := null; new.exception_at := null;
  return new;
end;
$$;

drop trigger if exists trg_toolbox_talk_attendees_before_insert on public.toolbox_talk_attendees;
create trigger trg_toolbox_talk_attendees_before_insert
  before insert on public.toolbox_talk_attendees
  for each row execute function public.toolbox_talk_attendees_before_insert();

-- Signing / exception-recording both happen as an UPDATE on the
-- attendee's own row — this IS the signature workflow (deliberately not
-- a separate signatures table: an attendee has at most one signature
-- ever, so the extra join would buy nothing commercial_signatures'
-- shape needs for its many-signatures-per-event case). Once signed_at
-- (or exception_reason) is first set, it is permanently locked — this
-- function is the only place either can ever be written, and it refuses
-- to let either be changed a second time.
create or replace function public.toolbox_talk_attendees_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.toolbox_talks where id = new.toolbox_talk_id;
  if v_status <> 'in_progress' then
    raise exception 'This toolbox talk is % — its attendee records are locked.', v_status;
  end if;

  new.toolbox_talk_id := old.toolbox_talk_id;
  new.project_id := old.project_id;
  new.added_by := old.added_by;
  new.created_at := old.created_at;

  if old.signed_at is not null then
    new.signed_at := old.signed_at;
    new.signature_data := old.signature_data;
    new.signature_typed_name := old.signature_typed_name;
    new.signed_by := old.signed_by;
  elsif new.signed_at is not null then
    if new.exception_reason is not null then
      raise exception 'An attendee cannot be both signed and recorded as an exception.';
    end if;
    new.signed_at := now();
    new.signed_by := auth.uid();
  end if;

  if old.exception_reason is not null then
    new.exception_reason := old.exception_reason;
    new.exception_recorded_by := old.exception_recorded_by;
    new.exception_at := old.exception_at;
  elsif new.exception_reason is not null then
    if new.signed_at is not null then
      raise exception 'An attendee cannot be both signed and recorded as an exception.';
    end if;
    new.exception_recorded_by := auth.uid();
    new.exception_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_toolbox_talk_attendees_before_update on public.toolbox_talk_attendees;
create trigger trg_toolbox_talk_attendees_before_update
  before update on public.toolbox_talk_attendees
  for each row execute function public.toolbox_talk_attendees_before_update();

-- ─── Audit integration ──────────────────────────────────────────────
-- toolbox_talks and toolbox_talk_attendees both carry a real project_id
-- already, so write_audit_log()'s existing generic branch covers talk-
-- started/updated, attendee-added/signed/excepted, and completion,
-- with zero changes to that function. They both default into
-- can_read_audit_row()'s existing editor-level fallback, which already
-- matches these tables' own RLS (can_edit_toolbox_talks) — also zero
-- changes needed there.
drop trigger if exists trg_audit_toolbox_talks on public.toolbox_talks;
create trigger trg_audit_toolbox_talks
  after insert or update on public.toolbox_talks
  for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_toolbox_talk_attendees on public.toolbox_talk_attendees;
create trigger trg_audit_toolbox_talk_attendees
  after insert or update or delete on public.toolbox_talk_attendees
  for each row execute function public.write_audit_log();

-- toolbox_talk_templates has no project_id at all (it's org- or system-
-- scoped, never project-scoped) — the same shape org_settings already
-- has, so it needs the same two small, precedented additions
-- write_audit_log()/can_read_audit_row() already carry for org_settings,
-- rather than a schema-wide audit rework. Template VERSIONS are
-- deliberately NOT run through the generic audit trigger at all: they
-- are themselves an append-only, immutable history (every version row
-- already carries its own created_by/created_at forever) — a separate
-- audit_log entry for "a version was created" would duplicate
-- information the versions table itself already preserves permanently.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

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

  -- Member-level (not editor-level) tables: projects/snag_items (Priority
  -- 1), documents/document_revisions (Phase Documents), and now
  -- toolbox_talks/toolbox_talk_attendees — matching their own real SELECT
  -- RLS (can_view_toolbox_talks, which a viewer already satisfies) exactly
  -- the same reasoning documents/document_revisions were added for: the
  -- function's editor-level default would otherwise incorrectly hide a
  -- viewer's own audit history for data they can already read directly.
  if p_table_name in ('projects', 'snag_items', 'documents', 'document_revisions', 'toolbox_talks', 'toolbox_talk_attendees') then
    return public.is_project_member(p_project_id);
  end if;

  return public.is_project_editor(p_project_id);
end;
$$;

drop trigger if exists trg_audit_toolbox_talk_templates on public.toolbox_talk_templates;
create trigger trg_audit_toolbox_talk_templates
  after insert or update on public.toolbox_talk_templates
  for each row execute function public.write_audit_log();

-- ─── v45 ADDITIONS: Toolbox Talk PDF export ───────────────────────────
-- Adds only a human-readable, immutable evidence reference to an
-- already-shipped table (toolbox_talks) — the PDF export's own header
-- needs one, since a raw UUID isn't something a site supervisor can
-- read out or file. Everything else the PDF needs (content_snapshot,
-- site_notes, attendees, signatures) already exists from v44 and is
-- already RLS-protected; PDF generation itself is client-side, reading
-- through the SAME can_view_toolbox_talks()-gated SELECT policies the
-- detail page already uses — there is deliberately no new RPC/endpoint
-- for this feature to create a second access-control surface to keep in
-- sync with the first. No new table, no storage of the generated file
-- (see tracker/README.md's Toolbox Talks PDF section): the completed
-- record is immutable and always reconstructable, so a stored copy
-- would only be a second, harder-to-secure copy of data that's already
-- durable.
alter table public.toolbox_talks add column if not exists reference text;

-- Full replacement of v44's toolbox_talks_before_write() — same
-- behaviour throughout, with reference generation added to the INSERT
-- branch and reference preservation added to the UPDATE branch's
-- immutable-identity-fields list. See sql/schema.sql's v44 section
-- above for the original.
create or replace function public.toolbox_talks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_version record;
  v_attendee_count integer;
  v_unresolved integer;
  v_next_ref integer;
begin
  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'toolbox_talks.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if TG_OP = 'INSERT' then
    select tv.template_id, tv.content, t.title, t.source_filename, t.org_id as template_org_id
      into v_version
      from public.toolbox_talk_template_versions tv
      join public.toolbox_talk_templates t on t.id = tv.template_id
      where tv.id = new.template_version_id;

    if v_version is null then
      raise exception 'toolbox_talks.template_version_id must reference an existing template version';
    end if;
    if v_version.template_id <> new.template_id then
      raise exception 'template_version_id must belong to the specified template_id';
    end if;
    if v_version.template_org_id is not null and v_version.template_org_id <> v_org_id then
      raise exception 'This template does not belong to your organisation';
    end if;

    new.content_snapshot := v_version.content;
    new.title := coalesce(nullif(trim(new.title), ''), v_version.title);
    new.source_filename := v_version.source_filename;
    new.delivered_by := auth.uid();
    new.started_at := now();
    new.status := 'in_progress';
    new.completed_by := null; new.completed_at := null;
    new.cancelled_by := null; new.cancelled_at := null; new.cancellation_reason := null;
    new.created_at := now();
    new.updated_at := now();

    -- A stable, human-readable evidence reference, scoped per-project
    -- and set once, never overwritten — set_snag_item_no()'s and
    -- commercial_events' own established per-project max+1 numbering
    -- convention exactly (same accepted residual concurrency risk as
    -- those two, documented at their own definitions; not a new
    -- pattern). Never overwrites an explicitly-supplied reference.
    if new.reference is null then
      select coalesce(max(substring(reference from '(\d+)$')::int), 0) + 1
        into v_next_ref
        from public.toolbox_talks
        where project_id = new.project_id;
      new.reference := 'TT-' || lpad(v_next_ref::text, 3, '0');
    end if;

    return new;
  end if;

  -- UPDATE path: identity/snapshot fields are permanently fixed from
  -- the moment the talk is started.
  new.created_at := old.created_at;
  new.org_id := old.org_id;
  new.project_id := old.project_id;
  new.template_id := old.template_id;
  new.template_version_id := old.template_version_id;
  new.content_snapshot := old.content_snapshot;
  new.source_filename := old.source_filename;
  new.delivered_by := old.delivered_by;
  new.started_at := old.started_at;
  new.reference := old.reference;
  new.updated_at := now();

  if old.status <> 'in_progress' then
    raise exception 'This toolbox talk is % and is immutable.', old.status;
  end if;

  if new.status <> old.status then
    if not public.valid_toolbox_talk_status_transition(old.status, new.status) then
      raise exception 'Invalid toolbox talk status transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'completed' then
      select count(*) into v_attendee_count from public.toolbox_talk_attendees where toolbox_talk_id = new.id;
      if v_attendee_count = 0 then
        raise exception 'Add at least one attendee before completing this talk.';
      end if;
      select count(*) into v_unresolved
        from public.toolbox_talk_attendees
        where toolbox_talk_id = new.id and signed_at is null and exception_reason is null;
      if v_unresolved > 0 then
        raise exception '% attendee(s) have not yet signed or been recorded as an exception.', v_unresolved;
      end if;
      new.completed_by := auth.uid();
      new.completed_at := now();
    elsif new.status = 'cancelled' then
      if new.cancellation_reason is null or length(trim(new.cancellation_reason)) = 0 then
        raise exception 'A cancellation reason is required to cancel a toolbox talk.';
      end if;
      new.cancelled_by := auth.uid();
      new.cancelled_at := now();
    end if;
  end if;

  return new;
end;
$$;
-- No trigger re-creation needed — trg_toolbox_talks_before_write (v44)
-- already points at this function by name; create or replace swaps its
-- body in place.

-- ─── v46 ADDITIONS: Toolbox Talks — automatic project-editor access ───
-- Real-world gap found via a trial account: project_module_roles (v44)
-- made Toolbox Talks access a fully separate, explicit opt-in grant from
-- project membership — correct for Commercial (sensitive financial
-- approvals, deliberately kept untouched here), but wrong for Toolbox
-- Talks (H&S safety briefings), which exist specifically to be seen and
-- delivered by everyone genuinely working on a site. This app has no
-- separate "subcontractor"/"main contractor" account concept — anyone
-- added to a project is either an owner, a full collaborator, or a
-- snagging-only member (is_project_editor() already draws exactly this
-- line) — so "make it automatic for subcontractors, the main
-- contractor, whoever's necessary" means: every owner/collaborator gets
-- Toolbox Talks access automatically, without an owner having to grant
-- project_module_roles rows one person at a time. Snagging-only members
-- stay excluded by default (matches their existing deliberately-minimal
-- access elsewhere) but can still be granted access explicitly via the
-- Module Permissions UI's existing project_module_roles mechanism,
-- which is untouched by this change and still the only way to grant the
-- higher 'editor' tier (org-wide template library editing — a
-- higher-trust action that must stay deliberate, never automatic).
--
-- effective_toolbox_talk_role() is the single new source of truth: an
-- explicit project_module_roles grant if one exists, else 'contributor'
-- if the caller is a project editor, else null. can_view_/
-- can_edit_toolbox_talks() are redefined to read it instead of calling
-- project_module_role() directly, so every existing RLS policy on
-- toolbox_talks/toolbox_talk_attendees (all of which already compose
-- through these two functions, never re-deriving the check themselves)
-- picks up the new behaviour with no policy changes needed.
-- can_edit_toolbox_talk_template_library() deliberately still calls
-- project_module_role() directly, not this function, so template-library
-- editing rights stay opt-in-only exactly as before.
create or replace function public.effective_toolbox_talk_role(p_project_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    public.project_module_role(p_project_id, 'toolbox_talks'),
    case when public.is_project_editor(p_project_id) then 'contributor' end
  );
$$;
grant execute on function public.effective_toolbox_talk_role(uuid) to authenticated;

create or replace function public.can_view_toolbox_talks(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.effective_toolbox_talk_role(p_project_id) in ('viewer', 'contributor', 'editor');
$$;

create or replace function public.can_edit_toolbox_talks(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.effective_toolbox_talk_role(p_project_id) in ('contributor', 'editor');
$$;

-- ─── v47 ADDITIONS: Commercial — real signatures, wider evidence, PDF ──
-- Three related gaps found against how Dayworks/Variations are actually
-- used: (1) "approval" was a confirm()-dialog attestation only — the
-- text itself said "not a legally binding external signature" — with no
-- captured signature image to put on a document sent externally; (2)
-- evidence upload only accepted images (accept="image/*"), but proof of
-- an instruction is usually an emailed PDF, not a photo — the server
-- side (createDocument()) was already format-agnostic, only the file
-- picker's accept attribute was narrow, so that part needs no schema
-- change; (3) no PDF export existed for a completed Daywork/Variation to
-- send to a client, mirroring the Toolbox Talks PDF export exactly
-- (client-side jsPDF, on-demand, reading through the same RLS-gated
-- queries the detail page already uses — no new endpoint).
--
-- Real signature capture reuses toolbox_talk_attendees' own
-- signature_data/signature_typed_name shape. commercial_signatures
-- itself still has NO insert/update/delete policy for any client role
-- (unchanged from v40) — a client still cannot fabricate, backdate, or
-- misattribute a signature. To let a real signature image/typed name
-- reach that trigger-only INSERT without opening a direct write path,
-- the caller supplies it as two ordinary, always-transient columns on
-- the SAME commercial_events UPDATE that changes status
-- (pending_signature_data/pending_signature_typed_name) — plain
-- PostgREST .update() calls require real columns, they can't carry
-- arbitrary extra JSON keys. commercial_events_before_write() captures
-- them into transaction-local variables, unconditionally nulls the
-- columns back out before the row is ever persisted (so the raw
-- signature is never actually stored anywhere on commercial_events,
-- only relayed through it), and hands them to
-- commercial_events_after_write() via a transaction-local GUC — the
-- exact same "app.<name>" one-shot relay pattern already used by
-- toolbox_talks_before_write()'s
-- app.allow_toolbox_talk_current_version_change. A signature or typed
-- name is now REQUIRED to approve (the one action a client actually
-- relies on as a sign-off); still optional for submit/reject, which
-- remain attested by account+timestamp alone as before.
alter table public.commercial_signatures add column if not exists signature_data text;
alter table public.commercial_signatures add column if not exists signature_typed_name text;

alter table public.commercial_events add column if not exists pending_signature_data text;
alter table public.commercial_events add column if not exists pending_signature_typed_name text;

-- Full replacement of v40's commercial_events_before_write() — same
-- behaviour throughout, with signature capture/clearing added at the
-- top, the two new transient columns added to every "pure status
-- change" comparison's exclusion list (so supplying a signature never
-- trips "no other field may change"), and a signature-required check
-- added to the 'approved' branch. See v40's original above for the
-- unmodified baseline.
create or replace function public.commercial_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_plot_project_id uuid;
  v_signer_email text;
  v_hash text;
  v_next_seq integer;
  v_pending_sig_data text;
  v_pending_sig_typed_name text;
begin
  -- Capture, then unconditionally clear — the raw signature is relayed
  -- through this row, never actually persisted on it. Done first so
  -- every later "did anything else change" comparison sees both old and
  -- new as null here (old was cleared the same way on its own write).
  v_pending_sig_data := new.pending_signature_data;
  v_pending_sig_typed_name := new.pending_signature_typed_name;
  new.pending_signature_data := null;
  new.pending_signature_typed_name := null;
  perform set_config('app.commercial_pending_signature_data', coalesce(v_pending_sig_data, ''), true);
  perform set_config('app.commercial_pending_signature_typed_name', coalesce(v_pending_sig_typed_name, ''), true);

  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'commercial_events.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'commercial_events.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the commercial event';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.status := 'draft'; -- an event can never be created pre-submitted/approved/rejected
    new.total_value := 0;
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    -- Auto-number the reference per project+type (e.g. DW-001, DW-002…)
    -- the moment it's needed by Phase 1's UI — mirrors
    -- set_snag_item_no()'s existing per-project max+1 convention
    -- exactly (sql/schema.sql, Priority 1), the established reference-
    -- numbering pattern in this codebase, not a new one. Never
    -- overwrites an explicitly-supplied reference.
    if new.reference is null then
      select coalesce(max(substring(reference from '(\d+)$')::int), 0) + 1
        into v_next_seq
        from public.commercial_events
        where project_id = new.project_id and type = new.type;
      new.reference := (case when new.type = 'daywork' then 'DW-' else 'VAR-' end) || lpad(v_next_seq::text, 3, '0');
    end if;

    return new;
  end if;

  -- identity fields are immutable regardless of payload
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.type := old.type; -- type never changes after creation
  new.org_id := old.org_id; -- re-derived above from project_id, but project_id itself never changes post-creation either (no policy allows editing it out from under an existing event)

  -- Absolute immutability once approved — nobody, including a project
  -- owner or org admin, may change anything at all. The only correction
  -- mechanism is a new row referencing this one via supersedes_id (no
  -- revision UI is built in this phase, but the guarantee holds from
  -- day one so nothing built on top of it later has to work around a
  -- gap that should never have existed).
  if old.status = 'approved' then
    raise exception 'This commercial event is approved and is immutable. Create a superseding record instead of editing it.';
  end if;

  if new.status <> old.status then
    if not public.valid_commercial_event_status_transition(old.status, new.status) then
      raise exception 'Invalid commercial event status transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'submitted' then
      if not public.can_submit_commercial(new.project_id) then
        raise exception 'You do not have permission to submit commercial events on this project';
      end if;
      -- Submitting must be a pure status flip — any content edit must
      -- already have been saved in a prior, separate update while still
      -- draft. Mirrors weekly_reports_before_write()'s own
      -- lock-on-transition comparison exactly.
      if (to_jsonb(new) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Save your changes first, then submit as a separate step.';
      end if;
      new.submitted_by := auth.uid();
      new.submitted_at := now();
      new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    elsif new.status = 'approved' then
      if not public.can_approve_commercial(new.project_id) then
        raise exception 'You do not have permission to approve commercial events on this project';
      end if;
      if old.created_by = auth.uid() then
        raise exception 'You cannot approve a commercial event you created yourself';
      end if;
      if v_pending_sig_data is null and v_pending_sig_typed_name is null then
        raise exception 'A signature or typed name is required to approve this record.';
      end if;
      if (to_jsonb(new) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Approval must be a pure status change — no other field may change at the same time.';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();

    elsif new.status = 'rejected' then
      if not public.can_approve_commercial(new.project_id) then
        raise exception 'You do not have permission to reject commercial events on this project';
      end if;
      -- no self-rejection restriction, per the approved architecture
      if (to_jsonb(new) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Rejection must be a pure status change (plus an optional reason) — no other field may change at the same time.';
      end if;
      new.rejected_by := auth.uid();
      new.rejected_at := now();

    elsif new.status = 'draft' then
      -- reopening a rejected record
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;

  else
    -- No status change: an ordinary content edit is only permitted
    -- while the record is genuinely open (draft/rejected). total_value/
    -- updated_at are system-maintained (the recompute trigger) and are
    -- excluded from this comparison so a line-item-driven total refresh
    -- is never mistaken for a disallowed user content edit.
    if old.status not in ('draft', 'rejected') then
      if (to_jsonb(new) - array['total_value', 'updated_at']::text[])
         is distinct from
         (to_jsonb(old) - array['total_value', 'updated_at']::text[]) then
        raise exception 'This commercial event is % — its content is locked until it is rejected back to draft.', old.status;
      end if;
    else
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;
  end if;

  return new;
end;
$$;
-- No trigger re-creation needed — trg_commercial_events_before_write
-- (v40) already points at this function by name; create or replace
-- swaps its body in place.

-- Full replacement of v40's commercial_events_after_write() — same
-- behaviour throughout, with signature_data/signature_typed_name added
-- to the commercial_signatures insert, read back from the
-- transaction-local GUCs the before-trigger above set.
create or replace function public.commercial_events_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer_email text;
  v_action text;
  v_sig_data text;
  v_sig_typed_name text;
begin
  if TG_OP <> 'UPDATE' or new.status = old.status then
    return new;
  end if;

  if new.status = 'submitted' then
    v_action := 'submitted';
  elsif new.status = 'approved' then
    v_action := 'approved';
  elsif new.status = 'rejected' then
    v_action := 'rejected';
  else
    return new; -- reopening to draft is not itself an attested action
  end if;

  select email into v_signer_email from auth.users where id = auth.uid();
  v_sig_data := nullif(current_setting('app.commercial_pending_signature_data', true), '');
  v_sig_typed_name := nullif(current_setting('app.commercial_pending_signature_typed_name', true), '');

  insert into public.commercial_signatures
    (commercial_event_id, project_id, action, signed_by_user_id, signed_by_name, org_id, statement_version, record_hash, signature_data, signature_typed_name)
  values
    (new.id, new.project_id, v_action, auth.uid(), coalesce(v_signer_email, 'unknown'), new.org_id, 'v1', public.commercial_event_hash(new.id), v_sig_data, v_sig_typed_name);

  return new;
end;
$$;
-- No trigger re-creation needed — trg_commercial_events_after_write
-- (v40) already points at this function by name; create or replace
-- swaps its body in place.

-- ─── v48 ADDITIONS: Commercial — on-site sign-off, no separate Approver account needed ──
-- Real-world gap reported after v47 shipped: a client raising/receiving a
-- Daywork/Variation almost never has a registered account on the project,
-- let alone one explicitly granted the 'approver' Commercial role — so
-- can_approve_commercial()'s gate, plus the "you cannot approve your own
-- submission" self-block, made the whole Sign & Approve step unreachable
-- in the most common real case: the site manager/subcontractor raises the
-- record, then wants to hand the same device straight to the client to
-- review the attached evidence and sign it there and then.
--
-- v47 already made a real signature (drawn or typed) mandatory to approve
-- at all — that signature IS the assurance now, not the signer's account
-- role. So the fix is to let anyone who can submit a record (i.e. anyone
-- with edit access to Commercial on the project — 'contributor' or
-- 'approver') also complete the approval, AS LONG AS they supply a
-- signature (already enforced), and to drop the self-approval block,
-- since "self" here refers to the logged-in account/device, not the
-- actual physical signer — the whole scenario is the account holder's own
-- device being handed to someone else to sign. Reject gets the identical
-- permission relaxation so a client declining on the spot isn't left with
-- no path either (a submitted record can only move to approved/rejected;
-- rejected is the only way back to draft for edits).
--
-- can_approve_commercial() itself is left in place unused by this trigger
-- — 'approver' remains a selectable Commercial role (still distinct from
-- 'viewer', still included in can_edit_commercial/can_submit_commercial),
-- it just no longer gates the approve/reject transition specifically,
-- since every approval already requires a captured signature regardless
-- of the signer's account role.
create or replace function public.commercial_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_plot_project_id uuid;
  v_signer_email text;
  v_hash text;
  v_next_seq integer;
  v_pending_sig_data text;
  v_pending_sig_typed_name text;
begin
  v_pending_sig_data := new.pending_signature_data;
  v_pending_sig_typed_name := new.pending_signature_typed_name;
  new.pending_signature_data := null;
  new.pending_signature_typed_name := null;
  perform set_config('app.commercial_pending_signature_data', coalesce(v_pending_sig_data, ''), true);
  perform set_config('app.commercial_pending_signature_typed_name', coalesce(v_pending_sig_typed_name, ''), true);

  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    raise exception 'commercial_events.project_id must reference an existing project with an organisation';
  end if;
  new.org_id := v_org_id;

  if new.plot_id is not null then
    select project_id into v_plot_project_id from public.plots where id = new.plot_id;
    if v_plot_project_id is null then
      raise exception 'commercial_events.plot_id must reference an existing plot';
    end if;
    if v_plot_project_id <> new.project_id then
      raise exception 'plot_id must belong to the same project as the commercial event';
    end if;
  end if;

  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.status := 'draft';
    new.total_value := 0;
    new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null;
    new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    if new.reference is null then
      select coalesce(max(substring(reference from '(\d+)$')::int), 0) + 1
        into v_next_seq
        from public.commercial_events
        where project_id = new.project_id and type = new.type;
      new.reference := (case when new.type = 'daywork' then 'DW-' else 'VAR-' end) || lpad(v_next_seq::text, 3, '0');
    end if;

    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.type := old.type;
  new.org_id := old.org_id;

  if old.status = 'approved' then
    raise exception 'This commercial event is approved and is immutable. Create a superseding record instead of editing it.';
  end if;

  if new.status <> old.status then
    if not public.valid_commercial_event_status_transition(old.status, new.status) then
      raise exception 'Invalid commercial event status transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'submitted' then
      if not public.can_submit_commercial(new.project_id) then
        raise exception 'You do not have permission to submit commercial events on this project';
      end if;
      if (to_jsonb(new) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'submitted_by', 'submitted_at', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Save your changes first, then submit as a separate step.';
      end if;
      new.submitted_by := auth.uid();
      new.submitted_at := now();
      new.rejected_by := null; new.rejected_at := null; new.rejection_reason := null;

    elsif new.status = 'approved' then
      -- v48: can_submit_commercial (contributor or approver), not
      -- can_approve_commercial — the mandatory signature below is what
      -- authorizes the approval now, not a separately-granted role.
      if not public.can_submit_commercial(new.project_id) then
        raise exception 'You do not have permission to approve commercial events on this project';
      end if;
      if v_pending_sig_data is null and v_pending_sig_typed_name is null then
        raise exception 'A signature or typed name is required to approve this record.';
      end if;
      -- v48: the "cannot approve your own submission" block is removed —
      -- the on-site flow this exists for is the raiser's own account/
      -- device being handed to someone else (the client) to sign, so a
      -- same-account check no longer reflects who actually signed.
      if (to_jsonb(new) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'approved_by', 'approved_at', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Approval must be a pure status change — no other field may change at the same time.';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();

    elsif new.status = 'rejected' then
      -- v48: same relaxation as approve, so a client declining on-site
      -- isn't blocked either — a project with nobody in the 'approver'
      -- role can still record a full submit/approve/reject cycle.
      if not public.can_submit_commercial(new.project_id) then
        raise exception 'You do not have permission to reject commercial events on this project';
      end if;
      if (to_jsonb(new) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[])
         is distinct from
         (to_jsonb(old) - array['status', 'rejected_by', 'rejected_at', 'rejection_reason', 'updated_at', 'total_value', 'pending_signature_data', 'pending_signature_typed_name']::text[]) then
        raise exception 'Rejection must be a pure status change (plus an optional reason) — no other field may change at the same time.';
      end if;
      new.rejected_by := auth.uid();
      new.rejected_at := now();

    elsif new.status = 'draft' then
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;

  else
    if old.status not in ('draft', 'rejected') then
      if (to_jsonb(new) - array['total_value', 'updated_at']::text[])
         is distinct from
         (to_jsonb(old) - array['total_value', 'updated_at']::text[]) then
        raise exception 'This commercial event is % — its content is locked until it is rejected back to draft.', old.status;
      end if;
    else
      if not public.can_edit_commercial(new.project_id) then
        raise exception 'You do not have permission to edit commercial events on this project';
      end if;
    end if;
  end if;

  return new;
end;
$$;
-- No trigger re-creation needed — trg_commercial_events_before_write
-- already points at this function by name; create or replace swaps its
-- body in place. commercial_events_after_write() (v47) is unchanged —
-- it still just reads the signature GUCs and inserts into
-- commercial_signatures, unaffected by who was allowed to trigger it.
