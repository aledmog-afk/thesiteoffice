-- v101 FORWARD MIGRATION. Programme import — Summary rows and % complete.
--
-- Standalone file following the v98/v99/v100 convention (sql/migrations/,
-- named vNN_<description>.sql) — sql/schema.sql already carries this
-- same block idempotently in its own v101 ADDITIONS section; applying
-- schema.sql already applies this. This file exists so the block can
-- be reviewed/run on its own too. Idempotent — safe to re-run, on a
-- fresh database or one already carrying v100.
--
-- No backfill: is_summary defaults false for every existing row (none
-- are retroactively flagged as summary bars — that only ever happens
-- on the NEXT import of a file that marks them), and percent_
-- raised_count defaults 0 for every existing programme_import_runs
-- row (there is nothing to recompute — the count only describes rows
-- actually raised by a run, and no run before this migration ever
-- carried a % complete column to raise from).
--
-- Do NOT apply this to the live Supabase project. The product owner
-- applies it separately, once Aled gives the final yes.

-- ─── v101 ADDITIONS: Programme import — Summary rows and % complete ──
--
-- Aled's own framing: Red Dragon's programme-driven progress reads 6%
-- for two compounding reasons — (a) summary/rollup bars (Ground Works
-- 2nd Stage, Structure to Watertight, Internal Fit Out, Batch rows)
-- get imported as ordinary activities and sit at 0% on top of their
-- own already-counted child tasks, dragging the weighted average down
-- hard (their planned span is often the whole programme's own span);
-- and (b) the import has never brought in % complete at all, so tasks
-- genuinely well under way (Ground Works 81%, Foundations 76%) sit at
-- a stale 0% until someone edits them by hand. This block gives the
-- import two new OPTIONAL columns to fix both: "Summary" (a flag) and
-- "% complete" (raise-only, same rule a weekly report already raises
-- programme activities by).
--
-- Column choice for the summary flag: a NEW is_summary boolean,
-- deliberately NOT a reuse of v99's exclude_from_progress. The two
-- are related (both end up excluded from compute_programme_complete_
-- pct() — see the OR below) but are conceptually different enough
-- that overloading one into the other would hide information: exclude_
-- from_progress already carries its own 'auto'/'manual' source
-- lifecycle (v99's own span-ratio auto-rule can tick AND untick an
-- 'auto' row automatically; a user's own manual tick/untick always
-- wins). A summary bar is not "a real task whose span happens to
-- distort the weighting" — it isn't a task at all, it is a rollup the
-- external programme includes for the reader's own benefit. Folding
-- "this is a rollup" into the SAME column as "a real task I've decided
-- not to count" would make it impossible to tell the two apart in the
-- UI (the whole point of programme.html's own "show them visually...
-- so users can see why they are excluded" requirement) and would risk
-- the v99 auto-rule silently unticking a summary row the next time its
-- span ratio shifts. A plain, independent, import-only column is the
-- honest shape: is_summary is never touched by the v99 auto/manual
-- machinery at all, and the two mechanisms are combined only at the
-- one place that actually needs the union — the "is this row counted"
-- predicate below.
alter table public.programme_activities add column if not exists is_summary boolean not null default false;

-- compute_programme_complete_pct(): extended with "or a.is_summary" —
-- note the OR, not a replacement: a row can still be independently
-- excluded via the pre-existing exclude_from_progress mechanism (auto
-- or manual) regardless of whether it's also flagged as a summary row.
create or replace function public.compute_programme_complete_pct(p_project_id uuid)
returns numeric
language sql stable security invoker set search_path = public as $$
  with active_programme as (
    select id from public.programmes where project_id = p_project_id and status = 'active' limit 1
  ),
  countable as (
    select
      a.status,
      a.percent_complete,
      case
        when a.is_milestone then 1
        when a.planned_start is not null and a.planned_finish is not null then greatest(1, a.planned_finish - a.planned_start)
        when a.forecast_start is not null and a.forecast_finish is not null then greatest(1, a.forecast_finish - a.forecast_start)
        else 1
      end as weight
    from public.programme_activities a
    where a.programme_id in (select id from active_programme)
      and a.status <> 'cancelled'
      and not a.exclude_from_progress
      and not a.is_summary
  )
  select case when coalesce(sum(weight), 0) > 0
    then round(sum(weight * (case when status = 'complete' then 100 else coalesce(percent_complete, 0) end)) / sum(weight), 1)
    else null
  end
  from countable;
$$;
revoke all on function public.compute_programme_complete_pct(uuid) from public, anon, authenticated;

-- programme_activities_v95_progress_after(): is_summary added to the
-- UPDATE field-watch-list (alongside exclude_from_progress already
-- there) so flipping it recalculates the stored project figure
-- immediately, the same as every other field that feeds
-- compute_programme_complete_pct(). The INSERT branch already
-- recalculates unconditionally, so a brand-new summary row needs no
-- extra handling here.
create or replace function public.programme_activities_v95_progress_after()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_source text;
begin
  v_pid := coalesce(new.project_id, old.project_id);

  if tg_op = 'INSERT' then
    perform public.apply_programme_auto_exclude(new.programme_id);
  elsif tg_op = 'UPDATE' and (
       new.planned_start is distinct from old.planned_start
    or new.planned_finish is distinct from old.planned_finish
    or new.is_milestone is distinct from old.is_milestone
  ) then
    perform public.apply_programme_auto_exclude(new.programme_id);
  end if;

  select progress_source into v_source from public.projects where id = v_pid;
  if v_source is distinct from 'programme' then
    return null;
  end if;
  if tg_op = 'DELETE' or tg_op = 'INSERT' then
    perform public.recalc_project_progress(v_pid);
  elsif new.percent_complete is distinct from old.percent_complete
     or new.status is distinct from old.status
     or new.is_milestone is distinct from old.is_milestone
     or new.planned_start is distinct from old.planned_start
     or new.planned_finish is distinct from old.planned_finish
     or new.forecast_start is distinct from old.forecast_start
     or new.forecast_finish is distinct from old.forecast_finish
     or new.exclude_from_progress is distinct from old.exclude_from_progress
     or new.is_summary is distinct from old.is_summary then
    perform public.recalc_project_progress(v_pid);
  end if;
  return null;
end;
$$;
revoke all on function public.programme_activities_v95_progress_after() from public, anon, authenticated;
-- Trigger itself is unchanged (same name, same attachment) — no
-- drop/create needed:
--   trg_programme_activities_v95_progress_after after insert or update or delete on public.programme_activities

-- programme_import_runs: one new count, alongside the four this table
-- already carries — "how many rows were raised" (requirement 3's own
-- explicit wording), tracked completely independently of the created/
-- updated/unchanged split above: a row can be "unchanged" in every
-- import-owned field (title/dates/milestone/plot/is_summary) and
-- STILL have had its own % complete raised this import — exactly Red
-- Dragon's real scenario (same title, same dates, only the % needed
-- to catch up).
alter table public.programme_import_runs add column if not exists percent_raised_count int not null default 0;

-- Redeclares import_programme_activities() with Summary/% complete
-- added — every existing line (matching, validation, row-level
-- rejection vs. whole-batch rollback, the v100 changes-payload/run
-- recording) is byte-identical to the v100 version. Additions:
--
-- (1) Summary ("is this row a rollup bar, never a real task"):
--     parsed only when the payload row actually carries the 'summary'
--     KEY at all (v_row ? 'summary') — never merely non-null, since a
--     mapped column's blank cell for one row is a real "no" (JSON
--     null, key present) while an UNMAPPED column is omitted by the
--     client entirely (key absent — see mapRowsToImportRows() in
--     app.js) — the only signal the server can trust to mean "this
--     import never asked about Summary for this row, leave whatever
--     is already stored alone." This is exactly what requirement 2
--     asks for ("Re-importing without the column must not clear an
--     existing summary flag") without inventing a second, parallel
--     tri-state column.
-- (2) % complete ("raise-only, consistent with existing rules"):
--     parsed the same safe, exception-proof way apply_weekly_report_
--     progress() above already parses a progress item's own percent
--     from jsonb (type-checked/regex-gated, never a raw ::numeric
--     cast that could abort the whole transaction over one bad
--     cell) — out-of-range values are rejected per-row, same as every
--     other row-level problem this function already reports back
--     rather than letting abort the batch. The actual raise — percent_
--     complete, status escalation, actual_start/actual_finish — is
--     delegated entirely to raise_programme_activity_from_report()
--     (the exact function a weekly report's own raise already calls),
--     passing it the import's OWN p_week_start/p_week_end — planned_
--     start (if passed) / forecast_finish-falling-back-to-planned_
--     finish (if passed), else today for either — never current_date
--     for both: an import has no "report week" of its own, and stamping
--     today's date onto a long-finished real task's actual_start/
--     actual_finish would otherwise be wrong and permanent (see the
--     UPDATE branch's own comment below for the full story; this is
--     the same rule the Complete button on programme.html already uses).
--     Called for a row regardless of whether its import-owned fields changed
--     — a % raise is tracked and counted entirely independently of
--     the created/updated/unchanged split (see percent_raised_count's
--     own comment above).
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
  v_raised int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_created_ids uuid[] := '{}';
  v_updated_ids uuid[] := '{}';
  v_unchanged_ids uuid[] := '{}';
  v_dup_external_ids text[];
  v_old record;
  v_changes jsonb[] := '{}';
  v_missing jsonb;
  v_run_id uuid;
  v_start_slip int;
  v_finish_slip int;
  v_summary_provided boolean;
  v_is_summary boolean;
  v_new_is_summary boolean;
  v_pct numeric;
  v_before_pct numeric;
  v_after_pct numeric;
  v_raised_this_row boolean;
  v_fields_changed boolean;
  v_resolved_finish date;
  v_import_week_start date;
  v_import_week_end date;
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

    -- v101: summary flag — only when the client actually mapped the
    -- column for this whole import (see this block's own header
    -- comment above for why key-presence, not mere non-null, is the
    -- right signal).
    v_summary_provided := (v_row ? 'summary');
    v_is_summary := v_summary_provided and lower(trim(coalesce(v_row->>'summary', ''))) in ('y', 'yes', 'true', '1');

    -- v101: % complete — type-checked/regex-gated, never a raw cast,
    -- so a garbage cell can never abort the whole batch; out-of-range
    -- values are rejected per-row below instead.
    v_pct := case
      when jsonb_typeof(v_row->'percent_complete') = 'number' then (v_row->>'percent_complete')::numeric
      when jsonb_typeof(v_row->'percent_complete') = 'string' and btrim(v_row->>'percent_complete') ~ '^[0-9]{1,3}(\.[0-9]+)?$'
        then btrim(v_row->>'percent_complete')::numeric
      else null
    end;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then
      v_rejected := v_rejected || jsonb_build_object('index', v_index, 'reason', format('Invalid percent_complete: "%s" (must be 0-100).', v_row->>'percent_complete'));
      continue;
    end if;

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
      insert into public.programme_activities (programme_id, plot_id, title, external_id, is_milestone, planned_start, planned_finish, is_summary)
      values (p_programme_id, v_plot_id, v_title, v_external_id, v_is_milestone, v_planned_start, v_planned_finish, v_is_summary)
      returning id into v_existing_id;
      v_created := v_created + 1;
      v_created_ids := v_created_ids || v_existing_id;

      v_before_pct := 0;
      v_after_pct := 0;
      v_raised_this_row := false;
      if v_pct is not null then
        -- v101 (post-review): the import's OWN dates, never current_date
        -- — see this row's twin computation in the UPDATE branch below
        -- for the full rationale (it's identical here; a brand-new row
        -- never already has a forecast_finish of its own).
        v_import_week_start := case when v_planned_start is not null and v_planned_start <= current_date then v_planned_start else current_date end;
        v_resolved_finish := v_planned_finish;
        v_import_week_end := case when v_resolved_finish is not null and v_resolved_finish <= current_date then v_resolved_finish else current_date end;
        perform public.raise_programme_activity_from_report(v_existing_id, v_project_id, v_pct, v_import_week_start, v_import_week_end);
        select percent_complete into v_after_pct from public.programme_activities where id = v_existing_id;
        v_raised_this_row := v_after_pct > coalesce(v_before_pct, 0);
        if v_raised_this_row then v_raised := v_raised + 1; end if;
      end if;

      v_changes := array_append(v_changes, jsonb_build_object(
        'activity_id', v_existing_id,
        'title', v_title,
        'created', true,
        'old_title', null,
        'old_planned_start', null, 'new_planned_start', v_planned_start,
        'old_planned_finish', null, 'new_planned_finish', v_planned_finish,
        'start_slip_days', null, 'finish_slip_days', null,
        'milestone_changed', false,
        'is_summary', v_is_summary,
        'summary_changed', false,
        'old_percent_complete', null,
        'new_percent_complete', (case when v_pct is not null then v_after_pct else null end)
      ));
    else
      select plot_id, title, external_id, is_milestone, planned_start, planned_finish, percent_complete, is_summary, forecast_finish
        into v_old
        from public.programme_activities where id = v_existing_id;

      v_new_is_summary := case when v_summary_provided then v_is_summary else v_old.is_summary end;

      v_fields_changed :=
           v_old.plot_id is distinct from v_plot_id
        or v_old.title is distinct from v_title
        or v_old.external_id is distinct from v_external_id
        or v_old.is_milestone is distinct from v_is_milestone
        or v_old.planned_start is distinct from v_planned_start
        or v_old.planned_finish is distinct from v_planned_finish
        or v_old.is_summary is distinct from v_new_is_summary;

      if v_fields_changed then
        update public.programme_activities
          set plot_id = v_plot_id, title = v_title, external_id = v_external_id,
              is_milestone = v_is_milestone, planned_start = v_planned_start, planned_finish = v_planned_finish,
              is_summary = v_new_is_summary
          where id = v_existing_id;
        v_updated := v_updated + 1;
        v_updated_ids := v_updated_ids || v_existing_id;
      else
        v_unchanged := v_unchanged + 1;
        v_unchanged_ids := v_unchanged_ids || v_existing_id;
      end if;

      -- % raise applies regardless of v_fields_changed above — a row
      -- can be identical in every import-owned field and still need
      -- its own % raised (Red Dragon's own real scenario).
      --
      -- v101 (post-review fix): the import's OWN dates, never
      -- current_date for both — the earlier version passed current_date
      -- as BOTH p_week_start and p_week_end, which meant every already-
      -- finished real task (e.g. a Demolition activity from last April,
      -- raised to 100% by today's import) got actual_start/actual_finish
      -- stamped with TODAY's date, silently overwriting what should have
      -- been its real, long-past dates — skewing Actual Finish, Variance
      -- and the Behind-schedule warning for every such row, permanently
      -- (raise_programme_activity_from_report() only fills a blank
      -- actual_start/actual_finish, so a wrong stamp here is never
      -- corrected by a later import). Fixed with the SAME rule the
      -- Complete button on programme.html already uses for exactly this
      -- reason (computeCompletionFields() there): actual_start (only
      -- filled while blank) is the activity's own planned_start if that
      -- date has already passed, else today (never a future date, never
      -- guessed past where there's no evidence for it); actual_finish at
      -- the transition into 'complete' (only filled while blank) is the
      -- best known finish date — forecast_finish, falling back to
      -- planned_finish when there's no forecast — if THAT has passed,
      -- else today. A brand-new row (the CREATE branch's own twin of
      -- this block, above) never already has a forecast_finish, so its
      -- resolved finish is simply planned_finish.
      v_before_pct := v_old.percent_complete;
      v_after_pct := v_old.percent_complete;
      v_raised_this_row := false;
      if v_pct is not null then
        v_import_week_start := case when v_planned_start is not null and v_planned_start <= current_date then v_planned_start else current_date end;
        v_resolved_finish := coalesce(v_old.forecast_finish, v_planned_finish);
        v_import_week_end := case when v_resolved_finish is not null and v_resolved_finish <= current_date then v_resolved_finish else current_date end;
        perform public.raise_programme_activity_from_report(v_existing_id, v_project_id, v_pct, v_import_week_start, v_import_week_end);
        select percent_complete into v_after_pct from public.programme_activities where id = v_existing_id;
        v_raised_this_row := v_after_pct > coalesce(v_before_pct, 0);
        if v_raised_this_row then v_raised := v_raised + 1; end if;
      end if;

      if v_fields_changed or v_raised_this_row then
        v_start_slip := case when v_old.planned_start is not null and v_planned_start is not null then (v_planned_start - v_old.planned_start) else null end;
        v_finish_slip := case when v_old.planned_finish is not null and v_planned_finish is not null then (v_planned_finish - v_old.planned_finish) else null end;
        v_changes := array_append(v_changes, jsonb_build_object(
          'activity_id', v_existing_id,
          'title', v_title,
          'created', false,
          'old_title', case when v_old.title is distinct from v_title then v_old.title else null end,
          'old_planned_start', v_old.planned_start, 'new_planned_start', v_planned_start,
          'old_planned_finish', v_old.planned_finish, 'new_planned_finish', v_planned_finish,
          'start_slip_days', v_start_slip, 'finish_slip_days', v_finish_slip,
          'milestone_changed', (v_old.is_milestone is distinct from v_is_milestone),
          'is_summary', v_new_is_summary,
          'summary_changed', (v_old.is_summary is distinct from v_new_is_summary),
          'old_percent_complete', v_before_pct,
          'new_percent_complete', v_after_pct
        ));
      end if;
    end if;
  end loop;

  -- Every pre-existing activity in this programme that this import
  -- neither created, updated, nor confirmed unchanged — i.e. simply
  -- absent from the payload altogether. Computed server-side from
  -- what this function itself actually did, never from anything the
  -- client claims.
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'external_id', external_id) order by title), '[]'::jsonb)
    into v_missing
    from public.programme_activities
    where programme_id = p_programme_id
      and not (id = any(v_created_ids || v_updated_ids || v_unchanged_ids));

  insert into public.programme_import_runs
    (org_id, project_id, programme_id, imported_by, created_count, updated_count, unchanged_count, not_in_import_count, percent_raised_count, changes)
  values
    (v_org_id, v_project_id, p_programme_id, auth.uid(), v_created, v_updated, v_unchanged, jsonb_array_length(v_missing), v_raised,
     jsonb_build_object('entries', to_jsonb(v_changes), 'not_in_import', v_missing))
  returning id into v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'raised', v_raised,
    'rejected', v_rejected,
    'created_ids', to_jsonb(v_created_ids),
    'updated_ids', to_jsonb(v_updated_ids)
  );
end;
$$;

grant execute on function public.import_programme_activities(uuid, jsonb) to authenticated;
