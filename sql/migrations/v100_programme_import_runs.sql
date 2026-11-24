-- v100 FORWARD MIGRATION. Programme revision record.
--
-- Standalone file following the v98/v99 convention (sql/migrations/,
-- named vNN_<description>.sql) — sql/schema.sql already carries this
-- same block idempotently in its own v100 ADDITIONS section; applying
-- schema.sql already applies this. This file exists so the block can
-- be reviewed/run on its own too. Idempotent — safe to re-run.
--
-- No backfill: history starts from the first import run AFTER this
-- lands (import_programme_activities() itself writes the row, in the
-- same transaction as the import) — there is nothing to backfill for
-- imports that already happened before this table existed.
--
-- Do NOT apply this to the live Supabase project. The product owner
-- applies it separately, once Aled gives the final yes.

-- ─── v100 ADDITIONS: Programme revision record ───────────────────────
--
-- Aled's own framing: "a record of every import, a PDF of what
-- changed, and the changes added automatically to that week's weekly
-- report." This is the first of those three — the PDF (app.js) and
-- the weekly report section both read FROM this table afterwards,
-- never recompute anything themselves.
--
-- Stuart's requirement: the row is written by import_programme_
-- activities() itself, in the SAME transaction as the import it
-- records, so it can never be skipped by the page or edited
-- afterwards. The write side follows the audit_log precedent above
-- exactly (see its own comment, ~line 2683): enabled, deliberately NO
-- insert/update/delete policy at all. Postgres denies those outright
-- to every role except the table owner / a security-definer function
-- that bypasses RLS — the only way a row can ever be written is from
-- inside import_programme_activities() below. No extra revoke/grant
-- needed beyond that: this project's own ALTER DEFAULT PRIVILEGES
-- entry already grants authenticated blanket table-level DML on every
-- new public table (mirrored for tests by tests/lib/mock_setup.sql's
-- own `grant select, insert, update, delete on all tables in schema
-- public to authenticated`), the same way audit_log itself relies on
-- RLS alone, never a table-level revoke, to block writes.
--
-- The READ side must match programme_activities' own read boundary
-- exactly, not plain project membership — a plain project_members row
-- (e.g. a snagging-only member) cannot see programme_activities
-- itself, so it must not be able to read every task name and date
-- change through this table either. This is the same combined
-- predicate (editor OR a party holding programme_read/programme_write)
-- already used, verbatim, for the other append-only history tables in
-- this exact position in the schema — progress_stage_events and
-- progress_tag_skips, a few hundred lines up — rather than a new
-- helper.
create table if not exists public.programme_import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  programme_id uuid not null references public.programmes(id) on delete cascade,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  not_in_import_count int not null default 0,
  -- {
  --   entries: [ { activity_id, title, created,
  --     old_title (null unless it changed),
  --     old_planned_start, new_planned_start,
  --     old_planned_finish, new_planned_finish,
  --     start_slip_days, finish_slip_days (signed; null when either
  --       side of that date is null, e.g. a newly created row),
  --     milestone_changed }, ... ],
  --   not_in_import: [ { id, title, external_id }, ... ]
  --     (every activity that existed before this import and was
  --     neither created, updated, nor confirmed unchanged by it)
  -- }
  changes jsonb not null default '{}'::jsonb
);

-- Query shapes this actually supports: "every run for this programme,
-- newest first" (the Revisions list on programme.html) and "every run
-- for this project" (the weekly report section, which reads by
-- programme but a project can in principle have switched programmes).
-- org_id indexed for the same advisor-hygiene convention every other
-- org_id column in this schema already follows.
create index if not exists programme_import_runs_programme_idx on public.programme_import_runs (programme_id, imported_at desc);
create index if not exists programme_import_runs_project_idx on public.programme_import_runs (project_id, imported_at desc);
create index if not exists programme_import_runs_org_idx on public.programme_import_runs (org_id);

alter table public.programme_import_runs enable row level security;
drop policy if exists "members read programme_import_runs" on public.programme_import_runs;
drop policy if exists "editors read programme_import_runs" on public.programme_import_runs;
create policy "editors read programme_import_runs" on public.programme_import_runs for select to authenticated
  using (public.is_project_editor(project_id)
         or project_id in (select public.party_cap_projects('programme_read'))
         or project_id in (select public.party_cap_projects('programme_write')));
-- Deliberately no insert/update/delete policy — see this table's own
-- header comment above.

-- Redeclares import_programme_activities() with the recording added —
-- every other line (matching, validation, row-level rejection vs.
-- whole-batch rollback) is byte-identical to the v36 original. Three
-- additions: (1) v_unchanged_ids, tracked the same way v_created_ids/
-- v_updated_ids already were, so "not in import" can be computed
-- precisely; (2) a v_changes entry appended for every created/updated
-- row, right where that row's own old/new values are already in
-- scope; (3) one INSERT into programme_import_runs, unconditionally,
-- right before the function returns — never inside a branch that
-- could skip it, and naturally rolled back along with everything else
-- if any earlier RAISE EXCEPTION in this function aborts the whole
-- transaction (an unauthorized caller, a bad programme id, or the
-- 5,000-row cap), so a failed/rejected-outright import leaves no run
-- row at all, matching a real import's own all-or-nothing contract.
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
  v_unchanged_ids uuid[] := '{}';
  v_dup_external_ids text[];
  v_old record;
  -- jsonb[] (a native PL/pgSQL array), not a jsonb array built via ||
  -- — jsonb concatenation has no "expanded object" fast path, so
  -- appending to a growing jsonb value in a loop is O(n) per append
  -- (O(n^2) total at 5,000 rows); array_append() on a jsonb[] gets the
  -- same amortised-O(1)-append optimisation v_created_ids/v_updated_ids
  -- above already rely on. Converted to a real jsonb array in one shot
  -- (to_jsonb()) only once, right before the final insert.
  v_changes jsonb[] := '{}';
  v_missing jsonb;
  v_run_id uuid;
  v_start_slip int;
  v_finish_slip int;
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
      v_changes := array_append(v_changes, jsonb_build_object(
        'activity_id', v_existing_id,
        'title', v_title,
        'created', true,
        'old_title', null,
        'old_planned_start', null, 'new_planned_start', v_planned_start,
        'old_planned_finish', null, 'new_planned_finish', v_planned_finish,
        'start_slip_days', null, 'finish_slip_days', null,
        'milestone_changed', false
      ));
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
          'milestone_changed', (v_old.is_milestone is distinct from v_is_milestone)
        ));
      else
        v_unchanged := v_unchanged + 1;
        v_unchanged_ids := v_unchanged_ids || v_existing_id;
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
    (org_id, project_id, programme_id, imported_by, created_count, updated_count, unchanged_count, not_in_import_count, changes)
  values
    (v_org_id, v_project_id, p_programme_id, auth.uid(), v_created, v_updated, v_unchanged, jsonb_array_length(v_missing),
     jsonb_build_object('entries', to_jsonb(v_changes), 'not_in_import', v_missing))
  returning id into v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
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
