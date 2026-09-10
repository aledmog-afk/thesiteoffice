'use client';

import { useState, useTransition } from 'react';
import { MEMBER_PALETTE } from '@/lib/palette';
import type { FamilyMember } from '@/types/database';

type Action = (formData: FormData) => Promise<{ ok?: true; error?: string }>;

export function MemberForm({
  member,
  action,
  submitLabel,
  onDone,
  takenColors = [],
}: {
  member?: FamilyMember;
  action: Action;
  submitLabel: string;
  onDone?: () => void;
  takenColors?: string[];
}) {
  const [color, setColor] = useState(member?.color ?? MEMBER_PALETTE[0].value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) setError(result.error);
      else onDone?.();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Name</span>
        <input
          name="display_name"
          defaultValue={member?.display_name ?? ''}
          maxLength={40}
          required
          className="mt-1 block h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-slate-900"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Emoji (optional)</span>
        <input
          name="avatar_emoji"
          defaultValue={member?.avatar_emoji ?? ''}
          placeholder="🦊"
          className="mt-1 block h-12 w-24 rounded-xl border border-slate-300 bg-white px-3 text-center text-2xl outline-none focus:border-slate-900"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Falls back to the first letter of their name.
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Colour</legend>
        <input type="hidden" name="color" value={color} />
        <div className="mt-2 flex flex-wrap gap-2">
          {MEMBER_PALETTE.map((swatch) => {
            const selected = swatch.value === color;
            // Not disabled — reassigning a colour between members is legitimate;
            // it just needs to be visibly flagged rather than silently allowed.
            const taken = takenColors.includes(swatch.value) && swatch.value !== member?.color;
            return (
              <button
                key={swatch.value}
                type="button"
                onClick={() => setColor(swatch.value)}
                aria-label={`${swatch.name}${taken ? ' (already used)' : ''}`}
                aria-pressed={selected}
                className={`relative h-11 w-11 rounded-full transition ${
                  selected ? 'ring-2 ring-slate-900 ring-offset-2' : ''
                }`}
                style={{ backgroundColor: swatch.value }}
              >
                {taken && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-600">
                    !
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Ten fixed swatches, so two people are never hard to tell apart across the room. A{' '}
          <span className="font-semibold">!</span> means another member already has that colour.
        </p>
      </fieldset>

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
