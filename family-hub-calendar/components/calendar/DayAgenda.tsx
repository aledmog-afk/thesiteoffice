'use client';

import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { toTimeInput } from '@/lib/calendar/timezone';
import type { Occurrence } from '@/lib/calendar/occurrences';

export function DayAgenda({
  occurrences,
  timeZone,
  onPickOccurrence,
}: {
  occurrences: Occurrence[];
  timeZone: string;
  onPickOccurrence: (occurrence: Occurrence) => void;
}) {
  const { colorFor, byId } = useMembers();

  if (occurrences.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing on today.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-y-auto">
      {occurrences.map((occurrence) => {
        const member = occurrence.memberId ? byId.get(occurrence.memberId) ?? null : null;
        return (
          <li key={occurrence.key}>
            <button
              type="button"
              onClick={() => onPickOccurrence(occurrence)}
              className="flex min-h-[64px] w-full items-center gap-3 px-3 text-left"
            >
              <span
                className="h-12 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorFor(occurrence.memberId) }}
                aria-hidden
              />
              <span className="w-20 shrink-0 text-sm font-semibold text-slate-600">
                {occurrence.allDay ? 'All day' : toTimeInput(occurrence.start, timeZone)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-medium">{occurrence.title}</span>
                {occurrence.location && (
                  <span className="block truncate text-sm text-slate-500">
                    {occurrence.location}
                  </span>
                )}
              </span>
              {member && <MemberAvatar member={member} size="md" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
