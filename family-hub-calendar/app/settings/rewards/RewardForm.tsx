'use client';

import { useState, useTransition } from 'react';
import type { RewardInput } from '@/app/(household)/rewards/actions';
import type { Reward } from '@/types/database';

export function RewardForm({
  reward,
  submitLabel,
  action,
  onDone,
}: {
  reward?: Reward;
  submitLabel: string;
  action: (input: RewardInput) => Promise<{ ok?: true; error?: string }>;
  onDone?: () => void;
}) {
  const [name, setName] = useState(reward?.name ?? '');
  const [description, setDescription] = useState(reward?.description ?? '');
  const [emoji, setEmoji] = useState(reward?.emoji ?? '');
  const [cost, setCost] = useState(String(reward?.point_cost ?? 20));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const parsed = Number(cost);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('A reward has to cost at least 1 point.');
      return;
    }

    startTransition(async () => {
      const result = await action({
        name,
        description: description || null,
        emoji: emoji || null,
        pointCost: parsed,
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
      <div className="flex gap-2">
        <label className="w-20">
          <span className="text-sm font-medium text-slate-700">Icon</span>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="📺"
            className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-2 text-center text-2xl"
          />
        </label>
        <label className="flex-1">
          <span className="text-sm font-medium text-slate-700">Reward</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            placeholder="30 min extra screen time"
            className="mt-1 block h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Cost in points</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="mt-1 block h-12 w-28 rounded-xl border border-slate-300 px-3 text-base"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Changing this later does not alter past redemptions — each one records what it actually
          cost.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Details (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Any night except a school night"
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
