'use client';

import { MemberAvatar } from './MemberAvatar';
import { useMembers } from './MemberProvider';

// One picker, four callers (events, chores, list items, meal cook). Single-select
// with an explicit "Everyone" option, which maps to a NULL member_id.
export function MemberPicker({
  value,
  onChange,
  allowEveryone = true,
  everyoneLabel = 'Everyone',
}: {
  value: string | null;
  onChange: (memberId: string | null) => void;
  allowEveryone?: boolean;
  everyoneLabel?: string;
}) {
  const { members } = useMembers();

  return (
    <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Assign to">
      {allowEveryone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={`flex min-h-[44px] items-center gap-2 rounded-2xl border-2 px-4 py-2 text-base font-medium transition ${
            value === null
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          {everyoneLabel}
        </button>
      )}

      {members.map((member) => {
        const selected = value === member.id;
        return (
          <button
            key={member.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(member.id)}
            className={`flex min-h-[44px] items-center gap-2 rounded-2xl border-2 py-2 pr-4 pl-2 text-base font-medium transition ${
              selected ? 'text-white' : 'border-slate-200 bg-white text-slate-700'
            }`}
            style={selected ? { backgroundColor: member.color, borderColor: member.color } : undefined}
          >
            <MemberAvatar member={member} size="sm" />
            {member.display_name}
          </button>
        );
      })}
    </div>
  );
}
