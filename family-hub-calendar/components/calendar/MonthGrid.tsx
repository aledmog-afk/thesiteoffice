'use client';

import { useMembers } from '@/components/members/MemberProvider';
import { addDaysToKey, dateKey } from '@/lib/calendar/timezone';
import type { Occurrence } from '@/lib/calendar/occurrences';

const DAY_LABELS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthGrid({
  gridStartKey,
  monthKey,
  occurrences,
  timeZone,
  weekStartsOn,
  todayKey,
  onPickDay,
  onPickOccurrence,
}: {
  gridStartKey: string;
  monthKey: string;
  occurrences: Occurrence[];
  timeZone: string;
  weekStartsOn: number;
  todayKey: string;
  onPickDay: (dateKey: string) => void;
  onPickOccurrence: (occurrence: Occurrence) => void;
}) {
  const { colorFor } = useMembers();
  const month = monthKey.slice(0, 7);

  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = dateKey(occurrence.start, timeZone);
    const list = byDay.get(key);
    if (list) list.push(occurrence);
    else byDay.set(key, [occurrence]);
  }

  const days = Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStartKey, i));
  const labels = weekStartsOn === 0 ? DAY_LABELS_SUN : DAY_LABELS_MON;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <div className="grid grid-cols-7 border-b border-slate-200">
        {labels.map((label) => (
          <div key={label} className="px-2 py-1 text-center text-xs font-semibold text-slate-500">
            {label}
          </div>
        ))}
      </div>

      {/* Fixed 6×7 with no scroll (§2.2): overflow shows a count rather than
          letting a busy week grow the page on a wall display. */}
      <div className="grid min-h-0 grid-cols-7 grid-rows-6">
        {days.map((key) => {
          const items = byDay.get(key) ?? [];
          const inMonth = key.slice(0, 7) === month;
          const isToday = key === todayKey;
          const shown = items.slice(0, 3);
          const hidden = items.length - shown.length;

          return (
            // The cell is a div carrying the "add on this day" tap, so the
            // event pills inside can be real buttons. A role="button" nested
            // inside a <button> is invalid and unreachable by keyboard.
            <div
              key={key}
              className={`flex min-h-0 flex-col items-stretch gap-0.5 overflow-hidden border-r border-b border-slate-100 p-1 ${
                inMonth ? 'bg-white' : 'bg-slate-50'
              }`}
            >
              <button
                type="button"
                onClick={() => onPickDay(key)}
                aria-label={`Open ${key}`}
                className="self-start"
              >
                <span
                  className={`rounded px-1 text-xs font-semibold ${
                    isToday
                      ? 'bg-slate-900 text-white'
                      : inMonth
                        ? 'text-slate-700'
                        : 'text-slate-400'
                  }`}
                >
                  {Number(key.slice(8, 10))}
                </span>
              </button>

              {shown.map((occurrence) => (
                <button
                  key={occurrence.key}
                  type="button"
                  onClick={() => onPickOccurrence(occurrence)}
                  className="truncate rounded px-1 text-left text-[11px] leading-4 font-medium text-white"
                  style={{ backgroundColor: colorFor(occurrence.memberId) }}
                >
                  {occurrence.title}
                </button>
              ))}

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onPickDay(key)}
                  className="px-1 text-left text-[11px] font-medium text-slate-500"
                >
                  +{hidden} more
                </button>
              )}

              {/* Remaining space is the day's own tap target, so a sparse day
                  is still one tap to open. */}
              <button
                type="button"
                onClick={() => onPickDay(key)}
                aria-hidden
                tabIndex={-1}
                className="min-h-0 flex-1"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
