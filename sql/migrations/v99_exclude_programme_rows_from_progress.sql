-- v99 FORWARD MIGRATION. Exclude programme rows from progress.
--
-- Standalone file following the v98 convention (sql/migrations/,
-- named vNN_<description>.sql) — sql/schema.sql already carries this
-- same block idempotently in its own v99 ADDITIONS section; applying
-- schema.sql already applies this. This file exists so the block can
-- be reviewed/run on its own too. Idempotent — safe to re-run.
--
-- Includes a one-off BACKFILL for existing rows (auto-tick only, see
-- its own comment below) — this is the one part of this migration
-- that writes to data that already exists, not just schema shape.
--
-- Do NOT apply this to the live Supabase project. The product owner
-- applies it separately, once they approve it, after checking the
-- auto-ticked list this migration's own PR describes for each site.

-- (A) The two new columns.
alter table public.programme_activities add column if not exists exclude_from_progress boolean not null default false;
alter table public.programme_activities add column if not exists exclude_from_progress_source text;
alter table public.programme_activities drop constraint if exists programme_activities_exclude_source_check;
alter table public.programme_activities add constraint programme_activities_exclude_source_check
  check (exclude_from_progress_source is null or exclude_from_progress_source in ('auto', 'manual'));

-- (B) The auto-exclude rule itself, as a callable, idempotent function
-- — a non-milestone activity whose own planned span is >= 90% of its
-- whole programme's planned span (min planned_start to max
-- planned_finish across every activity in it) is ticked, source
-- 'auto'; a row already 'auto' that no longer qualifies is unticked
-- the same way. A 'manual' row is never touched by either half. See
-- sql/schema.sql's own v99 ADDITIONS section for the full comment —
-- byte-identical here.
create or replace function public.apply_programme_auto_exclude(p_programme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_span numeric;
begin
  select max(planned_finish) - min(planned_start) into v_span
    from public.programme_activities
    where programme_id = p_programme_id
      and planned_start is not null and planned_finish is not null;

  if v_span is null or v_span <= 0 then
    return;
  end if;

  update public.programme_activities
     set exclude_from_progress = true, exclude_from_progress_source = 'auto'
   where programme_id = p_programme_id
     and coalesce(exclude_from_progress_source, '') <> 'manual'
     and is_milestone = false
     and planned_start is not null and planned_finish is not null
     and (planned_finish - planned_start) >= 0.9 * v_span
     and (exclude_from_progress is distinct from true or exclude_from_progress_source is distinct from 'auto');

  update public.programme_activities
     set exclude_from_progress = false, exclude_from_progress_source = null
   where programme_id = p_programme_id
     and exclude_from_progress_source = 'auto'
     and not (
       is_milestone = false
       and planned_start is not null and planned_finish is not null
       and (planned_finish - planned_start) >= 0.9 * v_span
     );
end;
$$;
revoke all on function public.apply_programme_auto_exclude(uuid) from public, anon, authenticated;

-- (C) compute_programme_complete_pct(): excludes a ticked row exactly
-- like a cancelled one.
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
  )
  select case when coalesce(sum(weight), 0) > 0
    then round(sum(weight * (case when status = 'complete' then 100 else coalesce(percent_complete, 0) end)) / sum(weight), 1)
    else null
  end
  from countable;
$$;
revoke all on function public.compute_programme_complete_pct(uuid) from public, anon, authenticated;

-- (D) programme_activities_v95_progress_after(): runs the auto-exclude
-- rule on insert, or on an update to planned_start/planned_finish/
-- is_milestone; exclude_from_progress joins the existing field list
-- that triggers a progress recalculation.
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
     or new.exclude_from_progress is distinct from old.exclude_from_progress then
    perform public.recalc_project_progress(v_pid);
  end if;
  return null;
end;
$$;
revoke all on function public.programme_activities_v95_progress_after() from public, anon, authenticated;
-- Trigger itself is unchanged (same name, same attachment):
--   trg_programme_activities_v95_progress_after after insert or update or delete on public.programme_activities

-- (E) One-off backfill (auto-tick only — a brand-new column has
-- nothing stale to untick yet). Safe to re-run: its own WHERE clause
-- only ever matches a row not already in the state it would put it
-- in.
with span as (
  select programme_id, max(planned_finish) - min(planned_start) as total_span
  from public.programme_activities
  where planned_start is not null and planned_finish is not null
  group by programme_id
  having max(planned_finish) - min(planned_start) > 0
)
update public.programme_activities a
   set exclude_from_progress = true, exclude_from_progress_source = 'auto'
  from span s
 where a.programme_id = s.programme_id
   and coalesce(a.exclude_from_progress_source, '') <> 'manual'
   and a.is_milestone = false
   and a.planned_start is not null and a.planned_finish is not null
   and (a.planned_finish - a.planned_start) >= 0.9 * s.total_span
   and (a.exclude_from_progress is distinct from true or a.exclude_from_progress_source is distinct from 'auto');
