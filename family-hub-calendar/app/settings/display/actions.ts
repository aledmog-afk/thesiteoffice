'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: true } | { error: string };

export type DisplayInput = {
  idleTimeoutSeconds: number;
  slideshowIntervalSeconds: number;
  dimStartsAt: string | null;
  dimEndsAt: string | null;
  dimMaxOpacity: number;
  weekStartsOn: number;
};

export async function updateDisplaySettings(input: DisplayInput): Promise<ActionResult> {
  if (!Number.isInteger(input.idleTimeoutSeconds) || input.idleTimeoutSeconds < 0) {
    return { error: 'Idle timeout must be zero or more seconds.' };
  }
  if (input.idleTimeoutSeconds > 3600) {
    return { error: 'Idle timeout is capped at an hour.' };
  }
  if (input.dimMaxOpacity < 0 || input.dimMaxOpacity > 0.95) {
    // Matches the CHECK in the schema: the screen must never be able to look
    // switched off.
    return { error: 'Dim strength must be between 0 and 0.95.' };
  }
  // Both bounds or neither: a half-set window is ambiguous, and dimOpacity
  // treats it as "off" anyway.
  if (Boolean(input.dimStartsAt) !== Boolean(input.dimEndsAt)) {
    return { error: 'Set both a dim start and end, or neither.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('household_settings')
    .update({
      idle_timeout_seconds: input.idleTimeoutSeconds,
      slideshow_interval_seconds: input.slideshowIntervalSeconds,
      dim_starts_at: input.dimStartsAt,
      dim_ends_at: input.dimEndsAt,
      dim_max_opacity: input.dimMaxOpacity,
      week_starts_on: input.weekStartsOn,
      updated_at: new Date().toISOString(),
    })
    // RLS scopes this to the one household; there is only ever one row.
    .not('household_id', 'is', null);

  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true };
}
