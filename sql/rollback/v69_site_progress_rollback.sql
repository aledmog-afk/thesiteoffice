-- v69 site progress ROLLBACK. Puts every plot, block and site figure and
-- the old 16/18-row plot grid back exactly as they were just before the
-- v69 go-live step, from the legacy_v69_* snapshots that step took.
--
-- When to use: only after the v69 go-live has been applied and a decision
-- has been made to go back. Pair it with reverting the v69 UI (revert the
-- PR), otherwise the new pages will read the old grid.
--
-- What it does, in one transaction (any error = nothing changes):
--   1. Refuses to run unless the v69 go-live marker and snapshots exist.
--   2. Stops v69 behaviour: drops the seven v69 TRIGGERS. No table, column
--      or function is dropped; all v69 history (stage events, overrides,
--      external works notes, packages, mapping log, flags) is kept.
--   3. Restores the pre-v69 seed_plot_defaults() (16/18-row grid).
--   4. Archives every 33-stage row of the plots that existed at go-live
--      into legacy_v69_rollback_stage_rows (kept), then removes them from
--      internal_milestones so the old plot page shows the old grid only.
--      Plots created after go-live keep their 33-stage rows (they have no
--      old grid to go back to).
--   5. Un-retires the old grid rows and restores their values exactly
--      from legacy_v69_internal_milestones (re-inserting any that went).
--   6. Restores plots.progress_pct, blocks.progress_pct and
--      projects.actual_progress_pct / external_works_pct from the
--      snapshots, writing only rows that actually differ (so no audit
--      noise for unchanged sites).
--   7. Records a 'v69_rolled_back' marker. v69's go-live step refuses to
--      run again while that marker exists.
-- Re-running this script is a no-op.

begin;

do $rb$
begin
  if to_regclass('public.progress_migration_runs') is null
     or not exists (select 1 from public.progress_migration_runs where step = 'v69_go_live') then
    raise exception 'v69 rollback: the v69 go-live step has not run here; nothing to roll back';
  end if;
  if to_regclass('public.legacy_v69_internal_milestones') is null
     or not exists (select 1 from public.legacy_v69_project_progress) then
    raise exception 'v69 rollback: v69 snapshots are missing; stopping';
  end if;
end;
$rb$;

-- 2. Stop v69 behaviour (triggers only).
drop trigger if exists trg_internal_milestones_v69_before on public.internal_milestones;
drop trigger if exists trg_internal_milestones_v69_after on public.internal_milestones;
drop trigger if exists trg_plots_v69_progress_guard on public.plots;
drop trigger if exists trg_plots_v69_after on public.plots;
drop trigger if exists trg_blocks_v69_after on public.blocks;
drop trigger if exists trg_projects_v69_progress_guard on public.projects;
drop trigger if exists trg_weekly_reports_v69_progress on public.weekly_reports;

-- 3. Pre-v69 seed_plot_defaults() (verbatim from schema.sql v24).
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
$$ language plpgsql set search_path = public;
revoke execute on function public.seed_plot_defaults() from public, anon, authenticated;

-- 4. Archive, then remove, the 33-stage rows of go-live plots.
create table if not exists public.legacy_v69_rollback_stage_rows (like public.internal_milestones including defaults);
alter table public.legacy_v69_rollback_stage_rows add column if not exists rolled_back_at timestamptz not null default now();
create unique index if not exists legacy_v69_rollback_stage_rows_id_idx on public.legacy_v69_rollback_stage_rows (id);
alter table public.legacy_v69_rollback_stage_rows enable row level security;
revoke all on public.legacy_v69_rollback_stage_rows from anon, authenticated;

insert into public.legacy_v69_rollback_stage_rows
select m.*, now()
  from public.internal_milestones m
 where m.stage_key is not null
   and m.plot_id in (select l.plot_id from public.legacy_v69_plot_progress l)
on conflict (id) do nothing;

delete from public.internal_milestones m
 where m.stage_key is not null
   and m.plot_id in (select l.plot_id from public.legacy_v69_plot_progress l)
   and exists (select 1 from public.legacy_v69_rollback_stage_rows a where a.id = m.id);

-- 5. Old grid rows back, exactly.
update public.internal_milestones m
   set retired_at = null, percent = s.percent, title = s.title, sort_order = s.sort_order, milestone_key = s.milestone_key
  from public.legacy_v69_internal_milestones s
 where m.id = s.id
   and (m.retired_at is not null or m.percent is distinct from s.percent or m.title is distinct from s.title
        or m.sort_order is distinct from s.sort_order or m.milestone_key is distinct from s.milestone_key);

insert into public.internal_milestones (id, project_id, plot_id, milestone_key, title, percent, sort_order, created_at)
select s.id, s.project_id, s.plot_id, s.milestone_key, s.title, s.percent, s.sort_order, s.created_at
  from public.legacy_v69_internal_milestones s
 where not exists (select 1 from public.internal_milestones m where m.id = s.id)
   and exists (select 1 from public.plots p where p.id = s.plot_id)
on conflict do nothing;

-- 6. Figures back, only where they differ.
update public.plots p set progress_pct = s.progress_pct
  from public.legacy_v69_plot_progress s
 where p.id = s.plot_id and p.progress_pct is distinct from s.progress_pct;

update public.blocks b set progress_pct = s.progress_pct
  from public.legacy_v69_block_progress s
 where b.id = s.block_id and b.progress_pct is distinct from s.progress_pct;

update public.projects j
   set actual_progress_pct = s.actual_progress_pct, external_works_pct = s.external_works_pct
  from public.legacy_v69_project_progress s
 where j.id = s.project_id
   and (j.actual_progress_pct is distinct from s.actual_progress_pct or j.external_works_pct is distinct from s.external_works_pct);

-- 7. Marker.
insert into public.progress_migration_runs (step, detail)
select 'v69_rolled_back', jsonb_build_object(
         'stage_rows_archived', (select count(*) from public.legacy_v69_rollback_stage_rows),
         'old_grid_rows_live', (select count(*) from public.internal_milestones m
                                 where m.id in (select s.id from public.legacy_v69_internal_milestones s) and m.retired_at is null))
on conflict (step) do nothing;

commit;
