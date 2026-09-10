'use client';

import { useState, useTransition } from 'react';
import { MemberPicker } from '@/components/members/MemberPicker';
import {
  fromWallClock,
  parseInputs,
  toDateInput,
  toTimeInput,
} from '@/lib/calendar/timezone';
import { buildRRule, freqFromRRule, type RepeatFreq } from '@/lib/calendar/rrule';
import {
  createEvent,
  deleteEvent,
  deleteOccurrence,
  updateEvent,
  updateOccurrence,
  type EventInput,
} from '@/app/(household)/calendar/actions';
import type { Occurrence } from '@/lib/calendar/occurrences';
import type { CalendarEvent } from '@/types/database';

const FREQS: { value: RepeatFreq; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export type SheetTarget =
  | { mode: 'create'; dateKey: string }
  | { mode: 'edit'; occurrence: Occurrence; master: CalendarEvent | null };

export function EventSheet({
  target,
  timeZone,
  onClose,
}: {
  target: SheetTarget;
  timeZone: string;
  onClose: () => void;
}) {
  const editing = target.mode === 'edit' ? target.occurrence : null;
  const master = target.mode === 'edit' ? target.master : null;

  const [title, setTitle] = useState(editing?.title ?? '');
  const [memberId, setMemberId] = useState<string | null>(editing?.memberId ?? null);
  const [allDay, setAllDay] = useState(editing?.allDay ?? false);
  const [location, setLocation] = useState(editing?.location ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');

  const [dateValue, setDateValue] = useState(
    editing ? toDateInput(editing.start, timeZone) : target.mode === 'create' ? target.dateKey : '',
  );
  const [startTime, setStartTime] = useState(
    editing ? toTimeInput(editing.start, timeZone) : '09:00',
  );
  const [endTime, setEndTime] = useState(editing ? toTimeInput(editing.end, timeZone) : '10:00');

  const [freq, setFreq] = useState<RepeatFreq>(freqFromRRule(master?.rrule ?? null));
  // "This one" vs "the whole series" — only meaningful on a recurring event.
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRecurring = Boolean(editing?.isRecurring);

  function buildInput(): EventInput | null {
    const startWall = parseInputs(dateValue, allDay ? '00:00' : startTime);
    if (!startWall) {
      setError('Pick a date.');
      return null;
    }
    const endWall = parseInputs(dateValue, allDay ? '23:59' : endTime);
    if (!endWall) {
      setError('Pick an end time.');
      return null;
    }

    const start = fromWallClock(startWall, timeZone);
    let end = fromWallClock(endWall, timeZone);
    // An end before the start reads as spilling past midnight, which is what a
    // "22:00–01:00" entry means to a person.
    if (end.getTime() < start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    const weekdayIndex = new Date(
      Date.UTC(startWall.year, startWall.month - 1, startWall.day),
    ).getUTCDay();

    return {
      title,
      memberId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      allDay,
      location: location || null,
      description: description || null,
      // Editing a single occurrence must never write an rrule onto the
      // exception row, or that occurrence becomes a series of its own.
      rrule:
        editing && isRecurring && scope === 'occurrence' ? null : buildRRule(freq, weekdayIndex),
      timeZone,
    };
  }

  function onSave() {
    setError(null);
    const input = buildInput();
    if (!input) return;

    startTransition(async () => {
      let result;
      if (!editing) {
        result = await createEvent(crypto.randomUUID(), input);
      } else if (isRecurring && scope === 'occurrence' && editing.masterId && editing.originalStart) {
        result = await updateOccurrence(
          editing.masterId,
          editing.originalStart.toISOString(),
          crypto.randomUUID(),
          input,
        );
      } else {
        result = await updateEvent(editing.masterId ?? editing.eventId, input);
      }

      if ('error' in result) setError(result.error);
      else onClose();
    });
  }

  function onDelete() {
    if (!editing) return;
    setError(null);

    startTransition(async () => {
      const result =
        isRecurring && scope === 'occurrence' && editing.masterId && editing.originalStart
          ? await deleteOccurrence(
              editing.masterId,
              editing.originalStart.toISOString(),
              crypto.randomUUID(),
            )
          : await deleteEvent(editing.masterId ?? editing.eventId);

      if ('error' in result) setError(result.error);
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{editing ? 'Edit event' : 'New event'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-400"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Date and time come first, and the title field is not autofocused:
              on a wall tablet an event is usually "something at 4pm", and
              raising the keyboard on open hides half the sheet (§2.2). */}
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-sm font-medium text-slate-700">Date</span>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
              />
            </label>
          </div>

          {!allDay && (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-sm font-medium text-slate-700">From</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
                />
              </label>
              <label className="flex-1">
                <span className="text-sm font-medium text-slate-700">To</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
                />
              </label>
            </div>
          )}

          <label className="flex min-h-[44px] items-center gap-3">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-6 w-6 rounded"
            />
            <span className="text-base">All day</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">What</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Dentist, football, birthday…"
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
            />
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">Who</span>
            <div className="mt-2">
              <MemberPicker value={memberId} onChange={setMemberId} everyoneLabel="Everyone" />
            </div>
          </div>

          {/* Repeat is hidden when editing a single occurrence: the choice does
              not apply, and showing it invites setting a rule that would be
              discarded. */}
          {!(editing && isRecurring && scope === 'occurrence') && (
            <div>
              <span className="text-sm font-medium text-slate-700">Repeat</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {FREQS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFreq(option.value)}
                    className={`min-h-[44px] rounded-xl border-2 px-4 text-sm font-medium ${
                      freq === option.value
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Where (optional)</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Notes (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
          </label>

          {isRecurring && (
            <fieldset className="rounded-xl bg-amber-50 p-3">
              <legend className="px-1 text-sm font-medium text-amber-900">
                This event repeats
              </legend>
              <div className="mt-1 flex gap-2">
                {(
                  [
                    { value: 'occurrence', label: 'Just this one' },
                    { value: 'series', label: 'The whole series' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setScope(option.value)}
                    className={`min-h-[44px] flex-1 rounded-xl border-2 px-3 text-sm font-medium ${
                      scope === option.value
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-amber-200 bg-white text-amber-900'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2 pb-2">
            <button
              type="button"
              onClick={onSave}
              disabled={pending}
              className="h-14 flex-1 rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="h-14 rounded-xl border-2 border-red-200 px-5 text-base font-semibold text-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
