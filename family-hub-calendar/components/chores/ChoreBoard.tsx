'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { ChoreCheckbox } from './ChoreCheckbox';
import { LedgerDrawer } from './LedgerDrawer';
import { useChoreBoard } from './useChoreBoard';
import { addDaysToKey } from '@/lib/calendar/timezone';
import { completeInstance, generateUpcoming, uncompleteInstance } from '@/app/(household)/chores/actions';
import type { Chore, ChoreInstance, FamilyMember, MemberPointsCache } from '@/types/database';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dowLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function ChoreBoard({
  householdId,
  weekStartKey,
  todayKey,
  chores,
  initialInstances,
  initialBalances,
}: {
  householdId: string;
  weekStartKey: string;
  todayKey: string;
  chores: Chore[];
  initialInstances: ChoreInstance[];
  initialBalances: MemberPointsCache[];
}) {
  const { members } = useMembers();
  const { state } = useHouseholdChannel();
  const weekEndKey = addDaysToKey(weekStartKey, 6);

  const { instances, balanceFor, patchInstance, refetch } = useChoreBoard(
    householdId,
    weekStartKey,
    weekEndKey,
    initialInstances,
    initialBalances,
  );

  const [error, setError] = useState<string | null>(null);
  const [drawerMember, setDrawerMember] = useState<FamilyMember | null>(null);
  const [pending, startTransition] = useTransition();

  const choreById = useMemo(() => new Map(chores.map((c) => [c.id, c])), [chores]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStartKey, i)),
    [weekStartKey],
  );

  // member id (or 'unassigned') -> due_on -> instances
  const grid = useMemo(() => {
    const map = new Map<string, Map<string, ChoreInstance[]>>();
    for (const instance of instances) {
      const memberKey = instance.member_id ?? 'unassigned';
      const forMember = map.get(memberKey) ?? new Map<string, ChoreInstance[]>();
      const forDay = forMember.get(instance.due_on) ?? [];
      forDay.push(instance);
      forMember.set(instance.due_on, forDay);
      map.set(memberKey, forMember);
    }
    return map;
  }, [instances]);

  const hasUnassigned = grid.has('unassigned');
  const columns: (FamilyMember | null)[] = hasUnassigned ? [...members, null] : members;

  function toggle(instance: ChoreInstance, done: boolean) {
    setError(null);
    // Optimistic, then rolled back on failure. The RPC is the source of truth
    // for the ledger row; Realtime brings the confirmed state and the new
    // balance a moment later.
    patchInstance(instance.id, {
      status: done ? 'done' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
      completed_by_member_id: done ? instance.member_id : null,
    });

    startTransition(async () => {
      const result = done
        ? await completeInstance(instance.id, instance.member_id)
        : await uncompleteInstance(instance.id);
      if ('error' in result) {
        setError(result.error);
        void refetch();
      }
    });
  }

  if (chores.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">No chores set up yet.</p>
        <Link
          href="/settings/chores"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
        >
          Add chores
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <h1 className="flex-1 text-base font-semibold">This week</h1>
        {state !== 'live' && (
          <span className="text-xs font-medium text-amber-600">Reconnecting…</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await generateUpcoming();
              if ('error' in result) setError(result.error);
              else void refetch();
            })
          }
          className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600 disabled:opacity-50"
        >
          Refresh schedule
        </button>
        <Link
          href="/settings/chores"
          className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
        >
          Manage
        </Link>
      </div>

      {error && (
        <p role="alert" className="bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Member columns × day rows (§2.3). Scrolls vertically by day rather
          than shrinking rows below a tappable size. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="grid min-w-full"
          style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(9rem, 1fr))` }}
        >
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white" />
          {columns.map((member) => (
            <div
              key={member?.id ?? 'unassigned'}
              className="sticky top-0 z-10 border-b border-slate-200 bg-white px-2 py-2"
            >
              {member ? (
                <button
                  type="button"
                  onClick={() => setDrawerMember(member)}
                  className="flex w-full min-h-[44px] items-center gap-2"
                >
                  <MemberAvatar member={member} size="md" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">
                      {member.display_name}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {balanceFor(member.id)?.balance ?? 0} pts
                    </span>
                  </span>
                </button>
              ) : (
                <span className="flex min-h-[44px] items-center text-sm font-semibold text-slate-500">
                  Anyone
                </span>
              )}
            </div>
          ))}

          {days.map((dayKey) => (
            <div key={dayKey} className="contents">
              <div
                className={`border-b border-slate-100 px-2 py-2 text-xs font-semibold ${
                  dayKey === todayKey ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'
                }`}
              >
                <span className="block">{dowLabel(dayKey)}</span>
                <span className="block">{Number(dayKey.slice(8))}</span>
              </div>

              {columns.map((member) => {
                const items = grid.get(member?.id ?? 'unassigned')?.get(dayKey) ?? [];
                return (
                  <div
                    key={`${dayKey}:${member?.id ?? 'unassigned'}`}
                    className="space-y-1 border-b border-l border-slate-100 p-1"
                  >
                    {items.map((instance) => {
                      const chore = choreById.get(instance.chore_id);
                      return (
                        <ChoreCheckbox
                          key={instance.id}
                          instance={instance}
                          title={chore?.title ?? 'Chore'}
                          color={member?.color ?? '#64748b'}
                          onToggle={(done) => toggle(instance, done)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {drawerMember && (
        <LedgerDrawer
          member={drawerMember}
          balance={balanceFor(drawerMember.id)?.balance ?? 0}
          onClose={() => setDrawerMember(null)}
        />
      )}
    </div>
  );
}
