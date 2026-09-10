'use client';

import { useState, useTransition } from 'react';
import { RewardForm } from './RewardForm';
import { createReward, setRewardActive, updateReward } from '@/app/(household)/rewards/actions';
import type { Reward } from '@/types/database';

export function RewardSettingsList({ rewards }: { rewards: Reward[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = rewards.filter((r) => r.is_active);
  const inactive = rewards.filter((r) => !r.is_active);

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
        {active.map((reward) => (
          <li key={reward.id} className="p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>
                {reward.emoji || '🎁'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{reward.name}</span>
                <span className="block text-xs text-slate-500">{reward.point_cost} points</span>
              </span>
              <button
                type="button"
                onClick={() => setEditing(editing === reward.id ? null : reward.id)}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600"
              >
                {editing === reward.id ? 'Cancel' : 'Edit'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void setRewardActive(reward.id, false))}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-500 disabled:opacity-50"
              >
                Retire
              </button>
            </div>

            {editing === reward.id && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <RewardForm
                  reward={reward}
                  submitLabel="Save changes"
                  action={(input) => updateReward(reward.id, input)}
                  onDone={() => setEditing(null)}
                />
              </div>
            )}
          </li>
        ))}

        {active.length === 0 && (
          <li className="p-4 text-sm text-slate-500">
            No rewards yet. Without any, earned points have nowhere to go.
          </li>
        )}
      </ul>

      <section className="rounded-2xl bg-white p-4">
        {adding ? (
          <>
            <h2 className="mb-4 text-base font-semibold">Add a reward</h2>
            <RewardForm
              submitLabel="Add reward"
              action={createReward}
              onDone={() => setAdding(false)}
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-2 min-h-[44px] w-full rounded-xl text-sm font-medium text-slate-500"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-base font-semibold text-white"
          >
            Add a reward
          </button>
        )}
      </section>

      {inactive.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
            Retired
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Retired rewards cannot be redeemed but still name past redemptions, which is why they
            are retired rather than deleted.
          </p>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white">
            {inactive.map((reward) => (
              <li key={reward.id} className="flex items-center gap-3 p-4 opacity-70">
                <span className="text-xl" aria-hidden>
                  {reward.emoji || '🎁'}
                </span>
                <span className="flex-1 truncate font-medium">{reward.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => void setRewardActive(reward.id, true))}
                  className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600 disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
