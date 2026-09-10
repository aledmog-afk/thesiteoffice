'use client';

import { useMemo, useState } from 'react';
import { MonthGrid } from './MonthGrid';
import { WeekGrid } from './WeekGrid';
import { DayAgenda } from './DayAgenda';
import { EventSheet, type SheetTarget } from './EventSheet';
import { useOccurrences } from './useOccurrences';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import {
  addDaysToKey,
  addMonthsToKey,
  dateKey,
  localMidnight,
  startOfMonthKey,
  startOfWeekKey,
} from '@/lib/calendar/timezone';
import type { CalendarEvent } from '@/types/database';

type ViewMode = 'day' | 'week' | 'month';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarShell({
  householdId,
  timeZone,
  weekStartsOn,
  todayKey,
  initialEvents,
}: {
  householdId: string;
  timeZone: string;
  weekStartsOn: number;
  todayKey: string;
  initialEvents: CalendarEvent[];
}) {
  // The kiosk opens on the week: a wall calendar answers "what's on this week"
  // far more often than either of the other two (§2.2).
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(todayKey);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const { state } = useHouseholdChannel();

  // One fetch keyed on the window, owned here — the three renderers are pure
  // views over the same Occurrence[].
  const { windowStartKey, windowDays } = useMemo(() => {
    if (view === 'day') return { windowStartKey: anchor, windowDays: 1 };
    if (view === 'week') {
      return { windowStartKey: startOfWeekKey(anchor, weekStartsOn), windowDays: 7 };
    }
    // Month view renders a fixed 6×7 grid, so the window is those 42 days
    // rather than the calendar month, or trailing days would render empty.
    return {
      windowStartKey: startOfWeekKey(startOfMonthKey(anchor), weekStartsOn),
      windowDays: 42,
    };
  }, [view, anchor, weekStartsOn]);

  const windowStart = useMemo(
    () => localMidnight(windowStartKey, timeZone),
    [windowStartKey, timeZone],
  );
  const windowEnd = useMemo(
    () => localMidnight(addDaysToKey(windowStartKey, windowDays), timeZone),
    [windowStartKey, windowDays, timeZone],
  );

  const { occurrences, events, loading } = useOccurrences(
    householdId,
    timeZone,
    windowStart,
    windowEnd,
    initialEvents,
  );

  const dayOccurrences = useMemo(
    () => occurrences.filter((o) => dateKey(o.start, timeZone) === anchor),
    [occurrences, anchor, timeZone],
  );

  function step(direction: -1 | 1) {
    if (view === 'day') setAnchor(addDaysToKey(anchor, direction));
    else if (view === 'week') setAnchor(addDaysToKey(anchor, 7 * direction));
    else setAnchor(addMonthsToKey(anchor, direction));
  }

  const heading = useMemo(() => {
    const [y, m, d] = anchor.split('-').map(Number);
    if (view === 'month') return `${MONTHS[m - 1]} ${y}`;
    if (view === 'day') return `${d} ${MONTHS[m - 1]} ${y}`;
    const start = startOfWeekKey(anchor, weekStartsOn);
    const end = addDaysToKey(start, 6);
    const sm = Number(start.slice(5, 7));
    const em = Number(end.slice(5, 7));
    return sm === em
      ? `${Number(start.slice(8))}–${Number(end.slice(8))} ${MONTHS[sm - 1]}`
      : `${Number(start.slice(8))} ${MONTHS[sm - 1]} – ${Number(end.slice(8))} ${MONTHS[em - 1]}`;
  }, [anchor, view, weekStartsOn]);

  function openOccurrence(occurrenceKey: string) {
    const occurrence = occurrences.find((o) => o.key === occurrenceKey);
    if (!occurrence) return;
    const master = occurrence.masterId
      ? events.find((e) => e.id === occurrence.masterId) ?? null
      : events.find((e) => e.id === occurrence.eventId) ?? null;
    setSheet({ mode: 'edit', occurrence, master });
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-xl text-slate-600"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setAnchor(todayKey)}
          className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-xl text-slate-600"
        >
          ›
        </button>

        <h1 className="ml-1 flex-1 text-base font-semibold">{heading}</h1>

        {state !== 'live' && (
          <span className="text-xs font-medium text-amber-600">Reconnecting…</span>
        )}
        {loading && state === 'live' && (
          <span className="text-xs font-medium text-slate-400">Updating…</span>
        )}

        <div className="flex gap-1">
          {(['day', 'week', 'month'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-current={view === mode ? 'true' : undefined}
              className={`min-h-[44px] rounded-xl px-3 text-sm font-medium capitalize ${
                view === mode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSheet({ mode: 'create', dateKey: anchor })}
          className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
        >
          Add
        </button>
      </header>

      <div className="min-h-0 bg-white">
        {view === 'month' && (
          <MonthGrid
            gridStartKey={windowStartKey}
            monthKey={startOfMonthKey(anchor)}
            occurrences={occurrences}
            timeZone={timeZone}
            weekStartsOn={weekStartsOn}
            todayKey={todayKey}
            onPickDay={(key) => {
              setAnchor(key);
              setView('day');
            }}
            onPickOccurrence={(o) => openOccurrence(o.key)}
          />
        )}

        {view === 'week' && (
          <WeekGrid
            weekStartKey={windowStartKey}
            days={7}
            occurrences={occurrences}
            timeZone={timeZone}
            todayKey={todayKey}
            onPickDay={(key) => setSheet({ mode: 'create', dateKey: key })}
            onPickOccurrence={(o) => openOccurrence(o.key)}
          />
        )}

        {view === 'day' && (
          <DayAgenda
            occurrences={dayOccurrences}
            timeZone={timeZone}
            onPickOccurrence={(o) => openOccurrence(o.key)}
          />
        )}
      </div>

      {sheet && (
        <EventSheet target={sheet} timeZone={timeZone} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
