'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';

export type EventInput = {
  title: string;
  memberId: string | null;
  startsAt: string; // ISO instant, already resolved from wall clock by the client
  endsAt: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  rrule: string | null;
  timeZone: string;
};

type ActionResult = { ok: true } | { error: string };

function validate(input: EventInput): string | null {
  if (!input.title.trim()) return 'Give the event a title.';
  if (input.title.length > 200) return 'That title is too long.';
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'That date looks wrong.';
  // The DB has the same CHECK; catching it here gives a usable message rather
  // than a constraint violation.
  if (end < start) return 'The end is before the start.';
  return null;
}

export async function createEvent(eventId: string, input: EventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { error } = await supabase.from('events').insert({
    id: eventId,
    household_id: householdId,
    title: input.title.trim(),
    member_id: input.memberId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    all_day: input.allDay,
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    rrule: input.rrule,
    event_timezone: input.timeZone,
    // No provider calendar yet (step 11), so everything starts local-only.
    sync_status: 'local_only',
  });

  if (error) return { error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

/** Edits the whole series, or a one-off. */
export async function updateEvent(eventId: string, input: EventInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({
      title: input.title.trim(),
      member_id: input.memberId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay,
      location: input.location?.trim() || null,
      description: input.description?.trim() || null,
      rrule: input.rrule,
      event_timezone: input.timeZone,
      local_updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);

  if (error) return { error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

/**
 * Edits one occurrence out of a series by writing an exception row against the
 * slot it replaces. The master is untouched, so "just this Tuesday" cannot
 * silently move every Tuesday.
 */
export async function updateOccurrence(
  masterId: string,
  originalStart: string,
  exceptionId: string,
  input: EventInput,
): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('recurrence_parent_id', masterId)
    .eq('recurrence_original_start', originalStart)
    .maybeSingle();

  const values = {
    title: input.title.trim(),
    member_id: input.memberId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    all_day: input.allDay,
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    event_timezone: input.timeZone,
    is_cancelled: false,
    local_updated_at: new Date().toISOString(),
  };

  const { error } = existing
    ? await supabase.from('events').update(values).eq('id', existing.id)
    : await supabase.from('events').insert({
        id: exceptionId,
        household_id: householdId,
        recurrence_parent_id: masterId,
        recurrence_original_start: originalStart,
        // An exception carries no rrule of its own; it occupies one slot.
        rrule: null,
        sync_status: 'local_only',
        ...values,
      });

  if (error) return { error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // Children cascade via recurrence_parent_id ON DELETE CASCADE, so deleting a
  // master takes its exceptions with it.
  const { error } = await supabase.from('events').delete().eq('id', eventId);

  if (error) return { error: error.message };
  revalidatePath('/calendar');
  return { ok: true };
}

/**
 * Removes one occurrence by recording a cancelled exception. A row has to be
 * left behind: occurrences are computed, so without it the next expansion
 * would put the deleted one straight back.
 */
export async function deleteOccurrence(
  masterId: string,
  originalStart: string,
  exceptionId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { data: existing } = await supabase
    .from('events')
    .select('id')
    .eq('recurrence_parent_id', masterId)
    .eq('recurrence_original_start', originalStart)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('events')
      .update({ is_cancelled: true, local_updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { error: error.message };
  } else {
    const { data: master, error: masterError } = await supabase
      .from('events')
      .select('title, starts_at, ends_at, all_day, event_timezone')
      .eq('id', masterId)
      .single();
    if (masterError) return { error: masterError.message };

    const durationMs = Date.parse(master.ends_at) - Date.parse(master.starts_at);
    const { error } = await supabase.from('events').insert({
      id: exceptionId,
      household_id: householdId,
      recurrence_parent_id: masterId,
      recurrence_original_start: originalStart,
      title: master.title,
      starts_at: originalStart,
      ends_at: new Date(Date.parse(originalStart) + durationMs).toISOString(),
      all_day: master.all_day,
      event_timezone: master.event_timezone,
      is_cancelled: true,
      sync_status: 'local_only',
    });
    if (error) return { error: error.message };
  }

  revalidatePath('/calendar');
  return { ok: true };
}
