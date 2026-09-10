'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { useTableSubscription } from '@/lib/realtime/useTableSubscription';
import { expandOccurrences, type Occurrence } from '@/lib/calendar/occurrences';
import type { CalendarEvent } from '@/types/database';

/**
 * Fetches the events that can touch [windowStart, windowEnd) and expands them.
 *
 * Two queries rather than one `.or()` with a nested `and(...)`: recurring
 * masters can start years before the window and still have occurrences inside
 * it, so they cannot be filtered by date at all, while one-offs must be. Two
 * simple filters are clearer and less brittle than one PostgREST expression,
 * and at household scale the extra round trip is irrelevant.
 */
export function useOccurrences(
  householdId: string,
  timeZone: string,
  windowStart: Date,
  windowEnd: Date,
  initialEvents: CalendarEvent[],
) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const { epoch } = useHouseholdChannel();

  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const [recurring, oneOffs] = await Promise.all([
        // Masters and their exception rows, regardless of date.
        supabase.from('events').select('*').or('rrule.not.is.null,recurrence_parent_id.not.is.null'),
        // Plain events that actually overlap the window.
        supabase
          .from('events')
          .select('*')
          .is('rrule', null)
          .is('recurrence_parent_id', null)
          .lt('starts_at', endIso)
          .gte('ends_at', startIso),
      ]);

      if (recurring.error || oneOffs.error) return;

      const merged = new Map<string, CalendarEvent>();
      for (const row of [...(recurring.data ?? []), ...(oneOffs.data ?? [])]) {
        merged.set(row.id, row);
      }
      setEvents([...merged.values()]);
    } finally {
      setLoading(false);
    }
  }, [supabase, startIso, endIso]);

  // Refetch when the window moves, and when the channel's epoch says this
  // client may have missed changes (reconnect, foreground, 15-minute floor).
  useEffect(() => {
    void refetch();
  }, [refetch, epoch]);

  // A single event change can add, move or remove several rendered occurrences,
  // so there is no useful in-place patch — refetch the window and re-expand.
  useTableSubscription<CalendarEvent>('events', householdId, () => {
    void refetch();
  });

  const occurrences = useMemo<Occurrence[]>(
    () => expandOccurrences(events, windowStart, windowEnd, timeZone),
    [events, startIso, endIso, timeZone, windowStart, windowEnd],
  );

  return { occurrences, events, loading, refetch };
}
