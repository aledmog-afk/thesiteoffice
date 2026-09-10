'use client';

import { useState, useTransition } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { MemberForm } from './MemberForm';
import { createMember, updateMember, retireMember, reactivateMember } from './actions';
import type { FamilyMember } from '@/types/database';

export function MemberList({
  active,
  retired,
}: {
  active: FamilyMember[];
  retired: FamilyMember[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const takenColors = active.map((m) => m.color);

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
        {active.map((member) => (
          <li key={member.id} className="p-4">
            <div className="flex items-center gap-3">
              <MemberAvatar member={member} size="lg" />
              <span className="flex-1 text-lg font-medium">{member.display_name}</span>
              <button
                type="button"
                onClick={() => setEditing(editing === member.id ? null : member.id)}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600"
              >
                {editing === member.id ? 'Cancel' : 'Edit'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void retireMember(member.id))}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-500 disabled:opacity-50"
              >
                Retire
              </button>
            </div>

            {editing === member.id && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <MemberForm
                  member={member}
                  takenColors={takenColors}
                  submitLabel="Save changes"
                  action={updateMember.bind(null, member.id)}
                  onDone={() => setEditing(null)}
                />
              </div>
            )}
          </li>
        ))}

        {active.length === 0 && (
          <li className="p-4 text-sm text-slate-500">
            No family members yet. Add the first one below — chores, events and lists all tag
            against these.
          </li>
        )}
      </ul>

      <section className="rounded-2xl bg-white p-4">
        {adding ? (
          <>
            <h2 className="mb-4 text-base font-semibold">Add a family member</h2>
            <MemberForm
              takenColors={takenColors}
              submitLabel="Add member"
              action={createMember}
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
            Add a family member
          </button>
        )}
      </section>

      {retired.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Retired
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Retired members keep their chore history and points ledger — that is why they are
            retired rather than deleted.
          </p>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
            {retired.map((member) => (
              <li key={member.id} className="flex items-center gap-3 p-4 opacity-70">
                <MemberAvatar member={member} size="md" />
                <span className="flex-1 font-medium">{member.display_name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => void reactivateMember(member.id))}
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
