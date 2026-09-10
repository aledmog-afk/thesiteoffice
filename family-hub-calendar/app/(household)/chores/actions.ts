'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';
import { generateChoreInstances } from '@/lib/chores/generate';
import { dateKey } from '@/lib/calendar/timezone';

type ActionResult = { ok: true } | { error: string };

export type ChoreInput = {
  title: string;
  notes: string | null;
  memberId: string | null;
  pointsValue: number;
  rrule: string | null;
  startsOn: string;
  endsOn: string | null;
};

function validate(input: ChoreInput): string | null {
  if (!input.title.trim()) return 'Give the chore a name.';
  if (input.title.length > 200) return 'That name is too long.';
  if (!Number.isInteger(input.pointsValue) || input.pointsValue < 0) {
    return 'Points must be a whole number, zero or more.';
  }
  if (input.pointsValue > 1000) return 'That is a lot of points — keep it under 1000.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) return 'Pick a start date.';
  if (input.endsOn && input.endsOn < input.startsOn) return 'The end is before the start.';
  return null;
}

async function householdTimeZone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from('households').select('timezone').single();
  return data?.timezone ?? 'UTC';
}

export async function createChore(input: ChoreInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { data, error } = await supabase
    .from('chores')
    .insert({
      household_id: householdId,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      member_id: input.memberId,
      points_value: input.pointsValue,
      rrule: input.rrule,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  // Generate immediately so a new chore appears on the board now, rather than
  // whenever the cron next runs — which also means the feature works before
  // any cron is wired up.
  const tz = await householdTimeZone();
  await generateChoreInstances(supabase, householdId, dateKey(new Date(), tz), data.id);

  revalidatePath('/chores');
  revalidatePath('/settings/chores');
  return { ok: true };
}

export async function updateChore(choreId: string, input: ChoreInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { error } = await supabase
    .from('chores')
    .update({
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      member_id: input.memberId,
      points_value: input.pointsValue,
      rrule: input.rrule,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    })
    .eq('id', choreId);

  if (error) return { error: error.message };

  // Future pending instances are stale after a schedule or assignee change.
  // Only pending ones go: a completed instance is history, and its ledger row
  // references it.
  const tz = await householdTimeZone();
  const today = dateKey(new Date(), tz);
  await supabase
    .from('chore_instances')
    .delete()
    .eq('chore_id', choreId)
    .eq('status', 'pending')
    .gte('due_on', today);

  await generateChoreInstances(supabase, householdId, today, choreId);

  revalidatePath('/chores');
  revalidatePath('/settings/chores');
  return { ok: true };
}

/** Deactivate rather than delete, so completed instances and their ledger
 *  rows keep their meaning. */
export async function setChoreActive(choreId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { error } = await supabase
    .from('chores')
    .update({ is_active: isActive })
    .eq('id', choreId);
  if (error) return { error: error.message };

  const tz = await householdTimeZone();
  const today = dateKey(new Date(), tz);

  if (isActive) {
    await generateChoreInstances(supabase, householdId, today, choreId);
  } else {
    await supabase
      .from('chore_instances')
      .delete()
      .eq('chore_id', choreId)
      .eq('status', 'pending')
      .gte('due_on', today);
  }

  revalidatePath('/chores');
  revalidatePath('/settings/chores');
  return { ok: true };
}

export async function completeInstance(
  instanceId: string,
  byMemberId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  // Via RPC, never a direct UPDATE: chore_instances has no UPDATE policy, and
  // the RPC is what writes the matching ledger row inside one transaction.
  const { error } = await supabase.rpc('complete_chore_instance', {
    p_instance_id: instanceId,
    p_by_member_id: byMemberId,
  });

  if (error) return { error: error.message };
  return { ok: true };
}

export async function uncompleteInstance(instanceId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // Writes an adjust_down rather than deleting the earn row, and clamps at
  // zero — so un-ticking a chore whose points were already spent reclaims
  // nothing (§2.3).
  const { error } = await supabase.rpc('uncomplete_chore_instance', {
    p_instance_id: instanceId,
  });

  if (error) return { error: error.message };
  return { ok: true };
}

/** Manual top-up, for use before a cron exists. */
export async function generateUpcoming(): Promise<{ inserted: number } | { error: string }> {
  const supabase = await createClient();
  const householdId = await currentHouseholdId();
  const tz = await householdTimeZone();

  const result = await generateChoreInstances(supabase, householdId, dateKey(new Date(), tz));
  if (result.error) return { error: result.error };

  revalidatePath('/chores');
  return { inserted: result.inserted };
}
