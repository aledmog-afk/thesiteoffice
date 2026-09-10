import type { ListItem } from '@/types/database';

export type ListChange =
  | { type: 'UPSERT'; row: ListItem }
  | { type: 'REMOVE'; id: string };

type RawPayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<ListItem> | Record<string, never>;
  old: Partial<ListItem> | Record<string, never>;
};

/**
 * Normalises a postgres_changes payload into a change this list can apply.
 *
 * The trap: on DELETE the payload's `new` is `{}` — an empty object, which is
 * NOT nullish — so `payload.new ?? payload.old` silently yields `{}` and the
 * delete is dropped. Branch on eventType instead.
 *
 * DELETE also only carries the primary key unless the table is REPLICA IDENTITY
 * FULL. 0001_init.sql sets that on list_items, which is what makes the
 * household_id filter match deletes rather than discarding them.
 */
export function normalizeChange(payload: RawPayload): ListChange | null {
  if (payload.eventType === 'DELETE') {
    const id = (payload.old as Partial<ListItem>).id;
    return id ? { type: 'REMOVE', id } : null;
  }

  const row = payload.new as Partial<ListItem>;
  if (!row.id || !row.list_id) return null;
  return { type: 'UPSERT', row: row as ListItem };
}

export const byPosition = (a: ListItem, b: ListItem) => a.position - b.position;

/**
 * Applies one change to the collection.
 *
 * Reconciliation rules, all keyed on `id`:
 *  - An upsert for a row already present replaces it — this is the echo of our
 *    own optimistic write, carrying identical values, so nothing visibly moves.
 *  - An upsert whose list_id is not this list removes the row: an item moved
 *    out of this list should leave it.
 *  - A row in `locallyRemoved` is ignored, so an UPDATE still in flight when we
 *    deleted the row cannot resurrect it.
 */
export function applyChange(
  items: readonly ListItem[],
  change: ListChange,
  listId: string,
  locallyRemoved: ReadonlySet<string> = new Set(),
): ListItem[] {
  if (change.type === 'REMOVE') {
    return items.filter((i) => i.id !== change.id);
  }

  const { row } = change;
  if (row.list_id !== listId) return items.filter((i) => i.id !== row.id);
  if (locallyRemoved.has(row.id)) return [...items];

  const index = items.findIndex((i) => i.id === row.id);
  if (index === -1) return [...items, row].sort(byPosition);

  const merged = [...items];
  merged[index] = row;
  return merged.sort(byPosition);
}
