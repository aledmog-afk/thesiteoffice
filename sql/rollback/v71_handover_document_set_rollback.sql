-- v71 ROLLBACK. Restores seed_plot_defaults()/seed_block_defaults() to
-- their pre-v71 bodies, drops the two new EWS1 triggers and the
-- seed_block_ews1_document() function, and relabels the two legacy
-- combined-certificate documents back to their original title.
--
-- Deliberately does NOT delete any data: not the new document rows
-- v71's backfill created (epc, elec_cert, gas_cert, fensa_certass,
-- block_lift_cert, block_ews1 — any that exist stay exactly as they
-- are, including anything already uploaded or approved against them),
-- not the blocks.needs_ews1 column, not its values. Running this
-- rollback only stops the NEW seeding behaviour for anything created
-- after the rollback runs; plots and blocks created between v71 and
-- this rollback keep the documents they already got. Safe to run more
-- than once (every statement is CREATE OR REPLACE / idempotent
-- UPDATE).
--
-- When to use: only if v71 itself turns out to cause a problem.

update public.handover_documents
set title = 'Electrical & Gas Safety Certificates'
where doc_key in ('elec_gas_certs', 'flat_elec_gas_certs')
  and title like '%legacy combined%';

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
revoke all on function public.seed_block_defaults() from public, anon, authenticated;

create or replace function public.seed_plot_defaults()
returns trigger as $$
declare
  v_prev text := coalesce(current_setting('app.progress_internal', true), '');
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

  perform set_config('app.progress_internal', 'on', true);
  insert into public.internal_milestones (project_id, plot_id, milestone_key, stage_key, title, sort_order, applicable)
  select new.project_id, new.id, s.stage_key, s.stage_key, s.name, s.sort_order,
         case when new.block_id is null then s.house_default_applicable else s.flat_default_applicable end
  from public.progress_stages s
  on conflict (plot_id, milestone_key) do nothing;
  perform set_config('app.progress_internal', v_prev, true);

  insert into public.snag_lists (project_id, plot_id, title)
  values (new.project_id, new.id, new.plot_number)
  on conflict (plot_id) do nothing;

  return new;
end;
$$ language plpgsql set search_path = public;
revoke all on function public.seed_plot_defaults() from public, anon, authenticated;

drop trigger if exists trg_seed_block_ews1_insert on public.blocks;
drop trigger if exists trg_seed_block_ews1_update on public.blocks;
drop function if exists public.seed_block_ews1_document();
