'use client';

import { useMemo, useState, useTransition } from 'react';
import { QuickAddBar } from './QuickAddBar';
import { ItemRow } from './ItemRow';
import { useListItems } from './useListItems';
import { parseQuickAdd } from '@/lib/lists/quickAdd';
import {
  addItem,
  assignItem,
  clearCompleted,
  deleteItem,
  setItemDone,
} from '@/app/(household)/lists/actions';
import type { List, ListItem } from '@/types/database';

export function ListView({
  list,
  householdId,
  initialItems,
}: {
  list: List;
  householdId: string;
  initialItems: ListItem[];
}) {
  const { items, refetch, upsertLocal, patchLocal, removeLocal, restoreLocal } = useListItems(
    list.id,
    householdId,
    initialItems,
  );
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [, startTransition] = useTransition();

  const pending = useMemo(() => items.filter((i) => !i.is_done), [items]);
  const done = useMemo(() => items.filter((i) => i.is_done), [items]);

  // Every handler below writes locally first, then calls the action, then
  // rolls back on failure. Realtime echoes carry the same values, so a
  // successful write never causes a visible second change.
  function handleAdd(raw: string, assignedMemberId: string | null) {
    const parsed = parseQuickAdd(raw);
    if (!parsed.title) return;

    const id = crypto.randomUUID();
    const optimistic: ListItem = {
      id,
      household_id: householdId,
      list_id: list.id,
      title: parsed.title,
      quantity_text: parsed.quantityText,
      aisle: null,
      is_done: false,
      done_at: null,
      done_by_member_id: null,
      assigned_member_id: assignedMemberId,
      source_meal_plan_entry_id: null,
      // Sorts to the end until the server's real position arrives.
      position: Number.MAX_SAFE_INTEGER,
      created_at: new Date().toISOString(),
    };

    setError(null);
    upsertLocal(optimistic);

    startTransition(async () => {
      const result = await addItem(list.id, id, raw, assignedMemberId);
      if ('error' in result) {
        removeLocal(id);
        setError(result.error);
      }
    });
  }

  function handleToggle(item: ListItem, isDone: boolean) {
    const before = { ...item };
    setError(null);
    patchLocal(item.id, {
      is_done: isDone,
      done_at: isDone ? new Date().toISOString() : null,
      // Attribute the tick to whoever the item was for; with no assignee it
      // stays null rather than guessing which family member is holding the
      // tablet — there is no per-member login to ask (§Auth model).
      done_by_member_id: isDone ? item.assigned_member_id : null,
    });

    startTransition(async () => {
      const result = await setItemDone(item.id, isDone, item.assigned_member_id);
      if ('error' in result) {
        upsertLocal(before);
        setError(result.error);
      }
    });
  }

  function handleAssign(item: ListItem, memberId: string | null) {
    const before = { ...item };
    setError(null);
    patchLocal(item.id, { assigned_member_id: memberId });

    startTransition(async () => {
      const result = await assignItem(item.id, memberId);
      if ('error' in result) {
        upsertLocal(before);
        setError(result.error);
      }
    });
  }

  function handleDelete(item: ListItem) {
    setError(null);
    removeLocal(item.id);

    startTransition(async () => {
      const result = await deleteItem(item.id);
      if ('error' in result) {
        restoreLocal(item);
        setError(result.error);
      }
    });
  }

  function handleClearCompleted() {
    const removed = [...done];
    setError(null);
    for (const item of removed) removeLocal(item.id);

    startTransition(async () => {
      const result = await clearCompleted(list.id);
      if ('error' in result) {
        setError(result.error);
        void refetch();
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Pinned above the list, not below it: the on-screen keyboard covers
          half a wall tablet, so the input must stay visible while it is open
          and the list shifts instead (§2.5). */}
      <QuickAddBar
        onAdd={handleAdd}
        placeholder={list.kind === 'shopping' ? 'Add to the shopping list…' : 'Add a to-do…'}
      />

      {error && (
        <p role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pending.length === 0 && done.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Nothing on this list yet.
          </p>
        ) : (
          <ul>
            {pending.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={(isDone) => handleToggle(item, isDone)}
                onAssign={(memberId) => handleAssign(item, memberId)}
                onDelete={() => handleDelete(item)}
              />
            ))}
          </ul>
        )}

        {/* Completed items collapse to a count rather than growing the scroll
            (§2.5) — a week of ticked shopping should not bury today's list. */}
        {done.length > 0 && (
          <section className="border-t border-slate-200">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="min-h-[44px] flex-1 text-left text-sm font-medium text-slate-500"
              >
                {showDone ? 'Hide' : 'Show'} {done.length} completed
              </button>
              <button
                type="button"
                onClick={handleClearCompleted}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-500"
              >
                Clear
              </button>
            </div>

            {showDone && (
              <ul className="bg-slate-50">
                {done.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={(isDone) => handleToggle(item, isDone)}
                    onAssign={(memberId) => handleAssign(item, memberId)}
                    onDelete={() => handleDelete(item)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
