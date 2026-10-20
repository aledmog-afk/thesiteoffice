-- v75 block-level build progress stages ROLLBACK. DDL-only — no block's
-- or site's progress_pct needs restoring, because the migration itself
-- guarantees (via its "hard acceptance" check) that no figure changed
-- when it went live: every existing block's manual figure was carried
-- over as an override before anything was recalculated, so
-- blocks.progress_pct and projects.actual_progress_pct are bit-for-bit
-- identical to what they were immediately before v75 ran. This rollback
-- only needs to remove the new structure, not restore any data.
--
-- When to use: after v75 (block progress stages) has been applied and a
-- decision has been made to go back. Pair it with reverting the v75 UI
-- (revert the PR), otherwise block-detail.html's new Build Stages
-- section will read tables that no longer exist.
--
-- What it does, in one transaction (any error = nothing changes):
--   1. Refuses to run unless the v75 go-live marker exists. RUN IT ONCE
--      ONLY — if the 'v75_block_stages_rolled_back' marker already
--      exists it stops straight away and changes nothing, and v75's own
--      go-live step refuses to re-run while that marker exists either.
--   2. Restores seed_block_defaults() to its pre-v75 body (drops the
--      block_milestones seeding it added — new blocks go back to just
--      gates + handover documents).
--   3. Restores apply_weekly_report_progress() to its pre-v75 body
--      (drops the block-raising half it added — a weekly report's
--      block-name tag goes back to being silently skipped, as before).
--   4. Drops the v75 triggers (block_milestones before/after,
--      blocks_v75_progress_guard) and the v75-only functions
--      (recalc_block_progress, resolve_block_tags, set_block_override,
--      clear_block_override, block_milestones_v75_before/after,
--      blocks_v75_progress_guard).
--   5. Drops the new tables (block_milestones, block_progress_overrides,
--      block_progress_stage_events) and the new blocks columns
--      (progress_calculated, progress_override and its note/by/at).
--      Every row in those tables — the full stage/override/event
--      history — is lost; this is the one genuinely destructive step,
--      and it's unavoidable (the columns/tables simply won't exist
--      after this). blocks.progress_pct itself is untouched by this
--      step, so the figure survives the rollback exactly as it was.
--   6. Records a 'v75_block_stages_rolled_back' marker.
--
-- If psql isn't run with ON_ERROR_STOP and the session stays open after
-- an error, run ROLLBACK.

begin;

do $rb$
begin
  if to_regclass('public.progress_migration_runs') is null
     or not exists (select 1 from public.progress_migration_runs where step = 'v75_block_stages_go_live') then
    raise exception 'v75 block stages rollback: the v75 go-live step has not run here; nothing to roll back';
  end if;
  if exists (select 1 from public.progress_migration_runs where step = 'v75_block_stages_rolled_back') then
    raise exception 'v75 block stages rollback has already run here (v75_block_stages_rolled_back marker exists); stopping without changing anything';
  end if;
end;
$rb$;

-- (1) seed_block_defaults(): drop the block_milestones insert this
-- migration added. Identical to the function's pre-v75 body (the same
-- one still live in sql/schema.sql's own history before this section).
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
    (new.project_id, new.id, 'block_insurance', 'Building Insurance / Buildings Warranty'),
    (new.project_id, new.id, 'block_lift_cert', 'Lift(s) Commissioning / Thorough Examination Certificate (LOLER)')
  on conflict (block_id, doc_key) do nothing;

  return new;
end;
$$ language plpgsql;
revoke all on function public.seed_block_defaults() from public, anon, authenticated;

-- (2) apply_weekly_report_progress(): drop the block-raising half,
-- restoring the pre-v75 (plots-only) body exactly.
create or replace function public.apply_weekly_report_progress(p_report_id uuid, p_source text default 'report')
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_rep record;
  v_item jsonb;
  v_stage text;
  v_pct numeric;
  v_hit uuid[];
  v_plots uuid[] := '{}';
  v_total integer := 0;
  v_pid uuid;
  v_prev_int text := coalesce(current_setting('app.progress_internal', true), '');
  v_prev_bulk text := coalesce(current_setting('app.progress_bulk', true), '');
  v_prev_src text := coalesce(current_setting('app.progress_source', true), '');
  v_prev_rep text := coalesce(current_setting('app.progress_report_id', true), '');
begin
  if p_source not in ('report', 'backfill') then
    raise exception 'apply_weekly_report_progress: bad source %', p_source;
  end if;
  select w.id, w.project_id, w.progress_items into v_rep from public.weekly_reports w where w.id = p_report_id;
  if not found or v_rep.progress_items is null or jsonb_typeof(v_rep.progress_items) <> 'array' then
    return 0;
  end if;

  perform set_config('app.progress_internal', 'on', true);
  perform set_config('app.progress_bulk', 'on', true);
  perform set_config('app.progress_source', p_source, true);
  perform set_config('app.progress_report_id', p_report_id::text, true);

  for v_item in select value from jsonb_array_elements(v_rep.progress_items) loop
    continue when jsonb_typeof(v_item) <> 'object';
    select s.stage_key into v_stage from public.progress_stages s where s.name = btrim(coalesce(v_item->>'milestone', ''));
    continue when v_stage is null;
    v_pct := case
      when jsonb_typeof(v_item->'percent') = 'number' then (v_item->>'percent')::numeric
      when jsonb_typeof(v_item->'percent') = 'string' and btrim(v_item->>'percent') ~ '^[0-9]{1,3}(\.[0-9]+)?$'
        then btrim(v_item->>'percent')::numeric
    end;
    continue when v_pct is null or v_pct <= 0 or v_pct > 100;

    insert into public.progress_tag_skips (project_id, weekly_report_id, tag, token, reason, source)
    select v_rep.project_id, p_report_id, coalesce(v_item->>'plot', ''), d.token, d.problem, p_source
      from public.resolve_plot_tags_detail(v_rep.project_id, v_item->>'plot') d
     where d.problem is not null
    on conflict do nothing;

    with u as (
      update public.internal_milestones m
         set percent = v_pct
       where m.project_id = v_rep.project_id
         and m.stage_key = v_stage
         and m.retired_at is null
         and m.applicable
         and m.percent < v_pct
         and m.plot_id in (select public.resolve_plot_tags(v_rep.project_id, v_item->>'plot'))
      returning m.plot_id
    )
    select coalesce(array_agg(u.plot_id), '{}') into v_hit from u;
    v_plots := v_plots || v_hit;
    v_total := v_total + coalesce(array_length(v_hit, 1), 0);
  end loop;

  if p_source = 'report' then
    for v_pid in select distinct x from unnest(v_plots) x loop
      perform public.recalc_plot_progress(v_pid);
    end loop;
    if v_total > 0 then
      perform public.recalc_project_progress(v_rep.project_id);
    end if;
  end if;

  perform set_config('app.progress_internal', v_prev_int, true);
  perform set_config('app.progress_bulk', v_prev_bulk, true);
  perform set_config('app.progress_source', v_prev_src, true);
  perform set_config('app.progress_report_id', v_prev_rep, true);
  return v_total;
end;
$$;
revoke all on function public.apply_weekly_report_progress(uuid, text) from public, anon, authenticated;

-- (3) Drop the v75 triggers.
drop trigger if exists trg_block_milestones_v75_before on public.block_milestones;
drop trigger if exists trg_block_milestones_v75_after on public.block_milestones;
drop trigger if exists trg_blocks_v75_progress_guard on public.blocks;

-- (4) Drop the v75-only functions.
drop function if exists public.recalc_block_progress(uuid);
drop function if exists public.resolve_block_tags(uuid, text);
drop function if exists public.set_block_override(uuid, numeric, text);
drop function if exists public.clear_block_override(uuid, text);
drop function if exists public.block_milestones_v75_before();
drop function if exists public.block_milestones_v75_after();
drop function if exists public.blocks_v75_progress_guard();

-- (5) Drop the new tables and columns. This is the one genuinely
-- destructive step — every stage/override/event row for every block is
-- lost. blocks.progress_pct itself is a plain column, untouched by
-- this, so the figure survives exactly as it was.
drop table if exists public.block_progress_stage_events;
drop table if exists public.block_progress_overrides;
drop table if exists public.block_milestones;
alter table public.blocks drop constraint if exists blocks_progress_override_check;
alter table public.blocks drop column if exists progress_override_at;
alter table public.blocks drop column if exists progress_override_by;
alter table public.blocks drop column if exists progress_override_note;
alter table public.blocks drop column if exists progress_override;
alter table public.blocks drop column if exists progress_calculated;

-- (6) Record the rollback marker.
insert into public.progress_migration_runs (step, detail) values ('v75_block_stages_rolled_back', jsonb_build_object('rolled_back_at', now()));

commit;
