'use client';

import { useState, useTransition } from 'react';
import { updateDisplaySettings } from './actions';
import { dimOpacity, timeToMinutes } from '@/lib/kiosk/dim';
import type { HouseholdSettings } from '@/types/database';

const IDLE_CHOICES = [
  { value: 0, label: 'Never' },
  { value: 60, label: '1 min' },
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
];

export function DisplayForm({ settings }: { settings: HouseholdSettings }) {
  const [idle, setIdle] = useState(settings.idle_timeout_seconds);
  const [dimStart, setDimStart] = useState((settings.dim_starts_at ?? '').slice(0, 5));
  const [dimEnd, setDimEnd] = useState((settings.dim_ends_at ?? '').slice(0, 5));
  const [strength, setStrength] = useState(settings.dim_max_opacity);
  const [weekStart, setWeekStart] = useState(settings.week_starts_on);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Same function the overlay uses, so the preview cannot drift from reality.
  const previewAt = (hour: number) =>
    dimOpacity(hour * 60, timeToMinutes(dimStart || null), timeToMinutes(dimEnd || null), strength);

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDisplaySettings({
        idleTimeoutSeconds: idle,
        slideshowIntervalSeconds: settings.slideshow_interval_seconds,
        dimStartsAt: dimStart ? `${dimStart}:00` : null,
        dimEndsAt: dimEnd ? `${dimEnd}:00` : null,
        dimMaxOpacity: strength,
        weekStartsOn: weekStart,
      });
      if ('error' in result) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <fieldset className="rounded-2xl bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Photo frame</legend>
        <p className="mb-3 text-xs text-slate-500">
          How long the wall tablet waits before switching to the frame. Phones ignore this.
        </p>
        <div className="flex flex-wrap gap-2">
          {IDLE_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setIdle(choice.value)}
              className={`min-h-[44px] rounded-xl border-2 px-4 text-sm font-medium ${
                idle === choice.value
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-2xl bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Night dimming</legend>
        <p className="mb-3 text-xs text-slate-500">
          Fades a dark layer over the screen on a schedule, ramped over 20 minutes so it never
          steps. On Fully Kiosk the real backlight is dimmed too, where the licence allows it.
        </p>

        <div className="flex gap-2">
          <label className="flex-1">
            <span className="text-sm font-medium text-slate-700">From</span>
            <input
              type="time"
              value={dimStart}
              onChange={(e) => setDimStart(e.target.value)}
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex-1">
            <span className="text-sm font-medium text-slate-700">Until</span>
            <input
              type="time"
              value={dimEnd}
              onChange={(e) => setDimEnd(e.target.value)}
              className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">
            Strength — {Math.round(strength * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="mt-2 block h-11 w-full"
          />
        </label>

        {/* A 24-hour strip so the wrap-around window is obvious at a glance
            rather than something to reason about. */}
        <div className="mt-3">
          <div className="flex h-8 overflow-hidden rounded-lg">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                title={`${String(hour).padStart(2, '0')}:00`}
                className="flex-1 bg-slate-200"
                style={{ backgroundColor: `rgba(15,23,42,${0.12 + previewAt(hour)})` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Week starts on</legend>
        <div className="mt-2 flex gap-2">
          {[
            { value: 1, label: 'Monday' },
            { value: 0, label: 'Sunday' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWeekStart(option.value)}
              className={`min-h-[44px] flex-1 rounded-xl border-2 px-4 text-sm font-medium ${
                weekStart === option.value
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Saved. The wall tablet picks this up on its next navigation.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-slate-900 text-base font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save display settings'}
      </button>
    </form>
  );
}
