'use client';

import { useRef, useState } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';

export function QuickAddBar({
  onAdd,
  placeholder,
}: {
  onAdd: (raw: string, assignedMemberId: string | null) => void;
  placeholder: string;
}) {
  const { members } = useMembers();
  const [value, setValue] = useState('');
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const raw = value.trim();
    if (!raw) return;
    onAdd(raw, assignTo);
    // Clear but keep focus: adding a shopping list is a burst of six items,
    // and re-tapping the field between each one is the whole cost of the
    // feature. The assignee deliberately persists across submits for the same
    // reason — "three things for Sam" is one decision, not three.
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-3 py-3 backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          className="h-14 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-lg outline-none focus:border-slate-900"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="h-14 shrink-0 rounded-xl bg-slate-900 px-5 text-base font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {members.length > 0 && (
        <div className="mt-2 flex items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-xs font-medium text-slate-500">For</span>
          <button
            type="button"
            onClick={() => setAssignTo(null)}
            className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${
              assignTo === null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            Anyone
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setAssignTo(assignTo === member.id ? null : member.id)}
              className={`flex shrink-0 items-center gap-1 rounded-lg py-1 pr-2 pl-1 text-xs font-medium ${
                assignTo === member.id ? 'text-white' : 'bg-slate-100 text-slate-600'
              }`}
              style={assignTo === member.id ? { backgroundColor: member.color } : undefined}
            >
              <MemberAvatar member={member} size="sm" />
              {member.display_name}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Quantities are picked up automatically — “milk x2”, “eggs 6”, “2 tins beans”.
      </p>
    </div>
  );
}
