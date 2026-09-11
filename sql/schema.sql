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
