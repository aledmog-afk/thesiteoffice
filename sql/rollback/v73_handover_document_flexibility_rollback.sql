-- Rollback for v73 (handover document flexibility: not_applicable
-- status + is_custom column).
--
-- DDL-only, exactly like the v70/v71/v72 rollbacks before it. This
-- restores the pre-v73 status check (missing/draft_received/
-- approved_final only) and the pre-v73 plots_before_write() body
-- (documents outstanding = status <> 'approved_final', with no
-- not_applicable exception).
--
-- IMPORTANT: if any handover_documents row has been set to
-- 'not_applicable' before this rollback runs, restoring the stricter
-- check constraint below will FAIL with a check-violation error
-- (Postgres validates existing rows against a newly-added constraint).
-- That failure is intentional, not a bug in this script — it means
-- real data depends on the status this migration added, and silently
-- rewriting those rows to a different status would be a real,
-- undiscussed data change this rollback has no business making. If
-- you hit that error, decide what those rows should become first
-- (reassign them, e.g. back to 'missing') before re-running this.
alter table public.handover_documents drop constraint if exists handover_documents_status_check;
alter table public.handover_documents add constraint handover_documents_status_check
  check (status in ('missing', 'draft_received', 'approved_final'));

-- is_custom is left alone deliberately — dropping it would silently
-- delete the one piece of information distinguishing a user-added
-- document from a standard one, with no way to tell them apart again.
-- If you are certain no custom documents exist (or don't care), drop
-- it yourself: alter table public.handover_documents drop column is_custom;

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
    if old.handed_over_at is not null then
      raise exception 'plots.handed_over_at is a historical record and cannot be changed once set';
    end if;

    select count(*) > 0 and bool_or(status not in ('approved', 'not_applicable'))
      into v_gate_outstanding
      from public.quality_gates where plot_id = new.id;

    select count(*) > 0 and bool_or(status <> 'approved_final')
      into v_doc_outstanding
      from public.handover_documents where plot_id = new.id;

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
