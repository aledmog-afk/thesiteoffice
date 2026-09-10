'use client';

import { useEffect, useRef } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useHouseholdChannel } from './HouseholdChannelProvider';

/**
 * Attaches one postgres_changes listener for `table`, filtered to this
 * household, onto the shared channel.
 *
 * Note on DELETE: the payload's `old` record only carries the primary key
 * unless the table is REPLICA IDENTITY FULL. 0001_init.sql sets that on the
 * tables filtered this way, which is what makes `household_id=eq.` match a
 * delete instead of dropping it.
 */
export function useTableSubscription<T extends Record<string, unknown>>(
  table: string,
  householdId: string,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void,
) {
  const { channel } = useHouseholdChannel();
  // Keep the latest callback without re-registering the listener every render.
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!channel) return;

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
      (payload) => handlerRef.current(payload as RealtimePostgresChangesPayload<T>),
    );
    // The channel is owned by the provider and torn down there; individual
    // listeners live as long as it does.
  }, [channel, table, householdId]);
}
