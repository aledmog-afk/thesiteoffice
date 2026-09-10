'use client';

import { useState } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import type { ListItem } from '@/types/database';

export function ItemRow({
  item,
  onToggle,
  onAssign,
  onDelete,
}: {
  item: ListItem;
  onToggle: (isDone: boolean) => void;
  onAssign: (memberId: string | null) => void;
  onDelete: () => void;
}) {
  const { members, byId } = useMembers();
  const [assigning, setAssigning] = useState(false);
  const assignee = item.assigned_member_id ? byId.get(item.assigned_member_id) ?? null : null;
  const doneBy = item.done_by_member_id ? byId.get(item.done_by_member_id) ?? null : null;

  return (
    <li className="border-b border-slate-100 last:border-0">
      <div className="flex min-h-[56px] items-center gap-3 px-3">
        {/* The checkbox is the row's primary target and sized for a thumb on a
            wall tablet, not a mouse. No confirmation: ticking is reversible. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={item.is_done}
          aria-label={`${item.is_done ? 'Un-tick' : 'Tick'} ${item.title}`}
          onClick={() => onToggle(!item.is_done)}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition ${
            item.is_done ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300 bg-white'
          }`}
        >
          {item.is_done && (
            <svg viewBox="0 0 20 20" className="h-6 w-6 text-white" aria-hidden>
              <path
                d="M5 10.5l3.5 3.5L15 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggle(!item.is_done)}
          className="flex-1 py-2 text-left"
        >
          <span
            className={`text-lg ${item.is_done ? 'text-slate-400 line-through' : 'text-slate-900'}`}
          >
            {item.title}
          </span>
          {item.quantity_text && (
            <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-sm font-medium text-slate-600">
              {item.quantity_text}
            </span>
          )}
          {item.source_meal_plan_entry_id && (
            <span className="ml-2 text-xs text-slate-400">from meal plan</span>
          )}
          {/* who should get it vs who actually did are different facts (§2.5) */}
          {item.is_done && doneBy && (
            <span className="ml-2 text-xs text-slate-400">✓ {doneBy.display_name}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAssigning((v) => !v)}
          aria-label={assignee ? `Assigned to ${assignee.display_name}` : 'Assign to someone'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        >
          {assignee ? (
            <MemberAvatar member={assignee} size="sm" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400">
              +
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${item.title}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-slate-400"
        >
          ×
        </button>
      </div>

      {/* Tap-to-assign rather than the long-press in §2.5: a long-press is
          undiscoverable on a wall display and fights the browser's own
          text-selection gesture. */}
      {assigning && (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={() => {
              onAssign(null);
              setAssigning(false);
            }}
            className={`min-h-[44px] rounded-xl border-2 px-3 text-sm font-medium ${
              assignee ? 'border-slate-200 bg-white text-slate-600' : 'border-slate-900 bg-slate-900 text-white'
            }`}
          >
            Anyone
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => {
                onAssign(member.id);
                setAssigning(false);
              }}
              className={`flex min-h-[44px] items-center gap-2 rounded-xl border-2 py-1 pr-3 pl-1 text-sm font-medium ${
                assignee?.id === member.id ? 'text-white' : 'border-slate-200 bg-white text-slate-700'
              }`}
              style={
                assignee?.id === member.id
                  ? { backgroundColor: member.color, borderColor: member.color }
                  : undefined
              }
            >
              <MemberAvatar member={member} size="sm" />
              {member.display_name}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
