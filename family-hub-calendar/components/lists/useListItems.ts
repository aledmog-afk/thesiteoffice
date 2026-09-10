'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { useTableSubscription } from '@/lib/realtime/useTableSubscription';
import { applyChange, byPosition, normalizeChange } from '@/lib/lists/reconcile';
import type { ListItem } from '@/types/database';

/**
 * Owns the item collection for one list: server-seeded, patched by Realtime,
 * and mutated optimistically.
 *
 * Deliberately not React 19's `useOptimistic`. That layers pending edits over a
 * base value React itself controls, but here the base is pushed asynchronously
 * by Realtime, so an echo arriving mid-transition drops the optimistic layer
 * and the row visibly flips back. Explicit state keyed on id makes the
 * reconciliation rule stateable in one line: whoever wrote last wins, and an
 * echo of our own write is a no-op because it carries the same values.
 */
export function useListItems(listId: string, householdId: string, initial: ListItem[]) {
  const [items, setItems] = useState<ListItem[]>(() => [...initial].sort(byPosition));
  const supabase = useMemo(() => createClient(), []);
  const { epoch } = useHouseholdChannel();
  // Rows deleted locally but not yet confirmed. Without this, a Realtime UPDATE
  // still in flight for a row we just removed would resurrect it.
  const removedRef = useRef<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', listId)
      .order('position');
    if (data) {
      removedRef.current.clear();
      setItems(data);
    }
  }, [supabase, listId]);

  // The channel is household-wide, so the change is filtered to this list
  // inside applyChange. Both steps live in lib/lists/reconcile.ts under unit
  // test — the DELETE payload shape and the optimistic-echo dedupe are too
  // easy to get subtly wrong to leave untested inside a hook.
  useTableSubscription<ListItem>('list_items', householdId, (payload) => {
    const change = normalizeChange(payload);
    if (!change) return;

    if (change.type === 'REMOVE') removedRef.current.delete(change.id);
    setItems((current) => applyChange(current, change, listId, removedRef.current));
  });

  // Realtime does not replay what was missed while the socket was down, so the
  // channel's epoch (reconnect, foreground, 15-minute floor) forces a resync.
  useEffect(() => {
    if (epoch > 0) void refetch();
  }, [epoch, refetch]);

  // Local mutations go through the same reducer as Realtime changes, so an
  // optimistic write and its echo can never disagree about ordering or dedupe.
  const upsertLocal = useCallback(
    (item: ListItem) => {
      setItems((current) => applyChange(current, { type: 'UPSERT', row: item }, listId));
    },
    [listId],
  );

  const patchLocal = useCallback((itemId: string, patch: Partial<ListItem>) => {
    setItems((current) =>
      current.map((i) => (i.id === itemId ? { ...i, ...patch } : i)).sort(byPosition),
    );
  }, []);

  const removeLocal = useCallback((itemId: string) => {
    removedRef.current.add(itemId);
    setItems((current) => applyChange(current, { type: 'REMOVE', id: itemId }, listId));
  }, [listId]);

  const restoreLocal = useCallback(
    (item: ListItem) => {
      removedRef.current.delete(item.id);
      upsertLocal(item);
    },
    [upsertLocal],
  );

  return { items, refetch, upsertLocal, patchLocal, removeLocal, restoreLocal };
}
