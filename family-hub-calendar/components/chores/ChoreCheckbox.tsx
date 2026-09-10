'use client';

import { useState } from 'react';
import type { ChoreInstance } from '@/types/database';

export function ChoreCheckbox({
  instance,
  title,
  color,
  onToggle,
}: {
  instance: ChoreInstance;
  title: string;
  color: string;
  onToggle: (done: boolean) => void;
}) {
  const done = instance.status === 'done';
  // A brief flash on award, rather than a toast: on a wall display the feedback
  // should be where the finger already is.
  const [justEarned, setJustEarned] = useState(false);

  function handle() {
    if (!done && instance.points_value > 0) {
      setJustEarned(true);
      setTimeout(() => setJustEarned(false), 1200);
    }
    onToggle(!done);
  }

  return (
    <button
      type="button"
      onClick={handle}
      aria-pressed={done}
      aria-label={`${done ? 'Un-tick' : 'Tick'} ${title}`}
      // 56px minimum: ticking is the most-used interaction on the wall, and it
      // is one tap with no confirmation because it is reversible (§2.3).
      className={`relative flex min-h-[56px] w-full items-center gap-2 rounded-xl border-2 px-2 text-left transition ${
        done ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
          done ? 'border-emerald-600 bg-emerald-600' : 'border-slate-300'
        }`}
        style={!done ? { borderColor: color } : undefined}
      >
        {done && (
          <svg viewBox="0 0 20 20" className="h-5 w-5 text-white" aria-hidden>
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
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-medium ${
            done ? 'text-emerald-800 line-through' : 'text-slate-800'
          }`}
        >
          {title}
        </span>
        {instance.points_value > 0 && (
          <span className="block text-xs text-slate-500">{instance.points_value} pts</span>
        )}
      </span>

      {justEarned && (
        <span className="absolute -top-2 -right-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
          +{instance.points_value}
        </span>
      )}
    </button>
  );
}
