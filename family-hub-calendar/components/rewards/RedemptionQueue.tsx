'use client';

import { useState, useTransition } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { cancelRedemption, fulfilRedemption } from '@/app/(household)/rewards/actions';
import type { Reward, RewardRedemption } from '@/types/database';

/**
 * Pending redemptions waiting on a parent. The queue exists because spending
 * points and actually getting the thing are separate events — "30 min extra
 * screen time" is claimed now and granted at bedtime.
 */
export function RedemptionQueue({
  redemptions,
  rewards,
  onChanged,
}: {
  redemptions: RewardRedemption[];
  rewards: Reward[];
  onChanged: () => void;
}) {
  const { byId } = useMembers();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rewardById = new Map(rewards.map((r) => [r.id, r]));
  const queue = redemptions.filter((r) => r.status === 'pending');

  if (queue.length === 0) return null;

  function act(fn: (id: string) => Promise<{ ok?: true; error?: string }>, id: string) {
    setError(null);
    startTransition(async () => {
      const result = await fn(id);
      if (result?.error) setError(result.error);
      else onChanged();
    });
  }

  return (
    <section className="rounded-2xl bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-900">
        Waiting to be given ({queue.length})
      </h2>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {queue.map((redemption) => {
          const member = byId.get(redemption.member_id);
          const reward = rewardById.get(redemption.reward_id);
          return (
            <li
              key={redemption.id}
              className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-2"
            >
              {member && <MemberAvatar member={member} size="md" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {reward?.name ?? 'Reward'}
                </span>
                <span className="block text-xs text-slate-500">
                  {member?.display_name ?? 'Someone'} ·{' '}
                  {/* The snapshotted cost, not the reward's current price. */}
                  {redemption.point_cost_at_redemption} pts ·{' '}
                  {new Date(redemption.redeemed_at).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(fulfilRedemption, redemption.id)}
                className="min-h-[44px] rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Given
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => act(cancelRedemption, redemption.id)}
                className="min-h-[44px] rounded-xl px-3 text-sm font-medium text-slate-600 disabled:opacity-50"
              >
                Cancel &amp; refund
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
