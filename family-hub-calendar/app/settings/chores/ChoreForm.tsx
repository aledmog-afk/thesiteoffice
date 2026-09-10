'use client';

import { useState, useTransition } from 'react';
import { MemberPicker } from '@/components/members/MemberPicker';
import { buildRRule, freqFromRRule, type RepeatFreq } from '@/lib/calendar/rrule';
import type { ChoreInput } from '@/app/(household)/chores/actions';
import type { Chore } from '@/types/database';

const FREQS: { value: RepeatFreq; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export function ChoreForm({
  chore,
  todayKey,
  submitLabel,
  action,
  onDone,
}: {
  chore?: Chore;
  todayKey: string;
  submitLabel: string;
  action: (input: ChoreInput) => Promise<{ ok?: true; error?: string }>;
  onDone?: () => void;
}) {
  const [title, setTitle] = useState(chore?.title ?? '');
  const [notes, setNotes] = useState(chore?.notes ?? '');
  const [memberId, setMemberId] = useState<string | null>(chore?.member_id ?? null);
  const [points, setPoints] = useState(String(chore?.points_value ?? 5));
  const [freq, setFreq] = useState<RepeatFreq>(freqFromRRule(chore?.rrule ?? null));
  const [startsOn, setStartsOn] = useState(chore?.starts_on ?? todayKey);
  const [endsOn, setEndsOn] = useState(chore?.ends_on ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const parsedPoints = Number(points);
    if (!Number.isInteger(parsedPoints) || parsedPoints < 0) {
      setError('Points must be a whole number, zero or more.');
      return;
    }

    const [y, m, d] = startsOn.split('-').map(Number);
    const weekdayIndex = Number.isFinite(y)
      ? new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      : 1;

    startTransition(async () => {
      const result = await action({
        title,
        notes: notes || null,
        memberId,
        pointsValue: parsedPoints,
        // A weekly chore repeats on the weekday its start date falls on, so
        // the rule cannot contradict the start date.
        rrule: buildRRule(freq, weekdayIndex),
        startsOn,
        endsOn: endsOn || null,
      });
      if (result?.error) setError(result.error);
      else onDone?.();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Chore</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          placeholder="Take the bins out"
          className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
        />
      </label>

      <div>
        <span className="text-sm font-medium text-slate-700">Who</span>
        <div className="mt-2">
          <MemberPicker value={memberId} onChange={setMemberId} everyoneLabel="Anyone" />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Only an assigned chore can earn points — “Anyone” chores appear on the board but have
          nobody to credit.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Points</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="mt-1 block h-12 w-24 rounded-xl border border-slate-300 px-3 text-base"
        />
      </label>

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

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="text-sm font-medium text-slate-700">Starts</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
          />
        </label>
        <label className="flex-1">
          <span className="text-sm font-medium text-slate-700">Ends (optional)</span>
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
