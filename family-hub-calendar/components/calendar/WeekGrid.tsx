'use client';

import { useMembers } from '@/components/members/MemberProvider';
import { addDaysToKey, dateKey, minutesIntoDay } from '@/lib/calendar/timezone';
import type { Occurrence } from '@/lib/calendar/occurrences';

const DAY_START_HOUR = 6; // the grid starts at 6am; earlier events clamp to it
const DAY_END_HOUR = 23;
const VISIBLE_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

export function WeekGrid({
  weekStartKey,
  days,
  occurrences,
  timeZone,
  todayKey,
  onPickDay,
  onPickOccurrence,
}: {
  weekStartKey: string;
  days: number;
  occurrences: Occurrence[];
  timeZone: string;
  todayKey: string;
  onPickDay: (dateKey: string) => void;
  onPickOccurrence: (occurrence: Occurrence) => void;
}) {
  const { colorFor } = useMembers();
  const dayKeys = Array.from({ length: days }, (_, i) => addDaysToKey(weekStartKey, i));

  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = dateKey(occurrence.start, timeZone);
    const list = byDay.get(key);
    if (list) list.push(occurrence);
    else byDay.set(key, [occurrence]);
  }

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] overflow-hidden">
      <div
        className="grid border-b border-slate-200"
        style={{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }}
      >
        <div />
        {dayKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPickDay(key)}
            className="px-1 py-1 text-center"
          >
            <span
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                key === todayKey ? 'bg-slate-900 text-white' : 'text-slate-700'
              }`}
            >
              {Number(key.slice(8, 10))}
            </span>
          </button>
        ))}
      </div>

      <div
        className="grid min-h-0 overflow-hidden"
        style={{ gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` }}
      >
        <div className="relative border-r border-slate-100">
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-slate-400"
              style={{ top: `${((hour - DAY_START_HOUR) * 60 * 100) / VISIBLE_MINUTES}%` }}
            >
              {hour}:00
            </span>
          ))}
        </div>

        {dayKeys.map((key) => (
          // Percentage positioning by minute offset, so the column scales to
          // whatever height the kiosk gives it without a scrollbar.
          <div
            key={key}
            className="relative border-r border-slate-100"
            onClick={() => onPickDay(key)}
          >
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute inset-x-0 border-t border-slate-100"
                style={{ top: `${((hour - DAY_START_HOUR) * 60 * 100) / VISIBLE_MINUTES}%` }}
              />
            ))}

            {(byDay.get(key) ?? []).map((occurrence) => {
              const startMin = occurrence.allDay
                ? DAY_START_HOUR * 60
                : minutesIntoDay(occurrence.start, timeZone);
              const endMin = occurrence.allDay
                ? DAY_START_HOUR * 60 + 40
                : Math.max(startMin + 20, minutesIntoDay(occurrence.end, timeZone));

              const top = ((Math.max(startMin, DAY_START_HOUR * 60) - DAY_START_HOUR * 60) * 100) /
                VISIBLE_MINUTES;
              const height = Math.min(
                100 - top,
                ((endMin - Math.max(startMin, DAY_START_HOUR * 60)) * 100) / VISIBLE_MINUTES,
              );

              return (
                <button
                  key={occurrence.key}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickOccurrence(occurrence);
                  }}
                  // 44px floor even for a 15-minute slot: a real tap target
                  // matters more than proportional height on a wall tablet.
                  className="absolute inset-x-0.5 min-h-[44px] overflow-hidden rounded-lg px-1 py-0.5 text-left text-[11px] leading-tight font-medium text-white"
                  style={{
                    top: `${top}%`,
                    height: `${height}%`,
                    backgroundColor: colorFor(occurrence.memberId),
                  }}
                >
                  <span className="block truncate">{occurrence.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
