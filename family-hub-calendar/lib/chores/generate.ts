import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Chore } from '@/types/database';
import { dueDatesFor, horizonFor } from './schedule';

export const HORIZON_DAYS = 14;

/**
 * Materialises chore_instances for one household up to the horizon.
 *
 * Idempotent by construction: `unique (chore_id, due_on)` in the schema means
 * re-running only ever inserts the gaps, so this is safe to call from a cron,
 * from a chore edit, and from a manual button without coordinating them.
 *
 * Takes a client rather than creating one so it can run either as the
 * household (RLS-scoped, from an action) or as the service role (across all
 * households, from the cron).
 */
export async function generateChoreInstances(
  supabase: SupabaseClient<Database>,
  householdId: string,
  todayKey: string,
  onlyChoreId?: string,
): Promise<{ inserted: number; error?: string }> {
  const { fromKey, toKey } = horizonFor(todayKey, HORIZON_DAYS);

  let query = supabase
    .from('chores')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_active', true);
  if (onlyChoreId) query = query.eq('id', onlyChoreId);

  const { data: chores, error } = await query;
  if (error) return { inserted: 0, error: error.message };

  const rows = (chores ?? []).flatMap((chore: Chore) =>
    dueDatesFor(chore, fromKey, toKey).map((due_on) => ({
      household_id: householdId,
      chore_id: chore.id,
      member_id: chore.member_id,
      due_on,
      // Snapshot the value, so raising a chore's points tomorrow never
      // rewrites what an already-generated instance is worth (§2.3).
      points_value: chore.points_value,
    })),
  );

  if (rows.length === 0) return { inserted: 0 };

  // ignoreDuplicates leaves existing instances — and their completion state —
  // completely alone. An upsert that overwrote would silently un-tick chores.
  const { data, error: insertError } = await supabase
    .from('chore_instances')
    .upsert(rows, { onConflict: 'chore_id,due_on', ignoreDuplicates: true })
    .select('id');

  if (insertError) return { inserted: 0, error: insertError.message };
  return { inserted: data?.length ?? 0 };
}
