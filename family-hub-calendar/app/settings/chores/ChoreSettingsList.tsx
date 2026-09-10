'use client';

import { useState, useTransition } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { ChoreForm } from './ChoreForm';
import { createChore, setChoreActive, updateChore } from '@/app/(household)/chores/actions';
import { describeRRule } from '@/lib/calendar/rrule';
import type { Chore } from '@/types/database';

export function ChoreSettingsList({
  chores,
  todayKey,
}: {
  chores: Chore[];
  todayKey: string;
}) {
  const { byId } = useMembers();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = chores.filter((c) => c.is_active);
  const inactive = chores.filter((c) => !c.is_active);

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
        {active.map((chore) => {
          const member = chore.member_id ? byId.get(chore.member_id) ?? null : null;
          return (
            <li key={chore.id} className="p-4">
              <div className="flex items-center gap-3">
                {member ? (
                  <MemberAvatar member={member} size="md" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-xs text-slate-400">
                    any
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{chore.title}</span>
                  <span className="block text-xs text-slate-500">
                    {describeRRule(chore.rrule)} · {chore.points_value} pts
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(editing === chore.id ? null : chore.id)}
                  className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600"
                >
                  {editing === chore.id ? 'Cancel' : 'Edit'}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => void setChoreActive(chore.id, false))}
                  className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-500 disabled:opacity-50"
                >
                  Retire
                </button>
              </div>

              {editing === chore.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <ChoreForm
                    chore={chore}
                    todayKey={todayKey}
                    submitLabel="Save changes"
                    action={(input) => updateChore(chore.id, input)}
                    onDone={() => setEditing(null)}
                  />
                </div>
              )}
            </li>
          );
        })}

        {active.length === 0 && (
          <li className="p-4 text-sm text-slate-500">No chores yet.</li>
        )}
      </ul>

      <section className="rounded-2xl bg-white p-4">
        {adding ? (
          <>
            <h2 className="mb-4 text-base font-semibold">Add a chore</h2>
            <ChoreForm
              todayKey={todayKey}
              submitLabel="Add chore"
              action={createChore}
              onDone={() => setAdding(false)}
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-2 min-h-[44px] w-full rounded-xl text-sm font-medium text-slate-500"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-base font-semibold text-white"
          >
            Add a chore
          </button>
        )}
      </section>

      {inactive.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Retired
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Retiring stops future instances being generated. Already-completed ones keep their
            points, because the ledger rows reference them.
          </p>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
            {inactive.map((chore) => (
              <li key={chore.id} className="flex items-center gap-3 p-4 opacity-70">
                <span className="flex-1 truncate font-medium">{chore.title}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => void setChoreActive(chore.id, true))}
                  className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600 disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
