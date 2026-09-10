'use client';

import { useState, useTransition } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { redeemErrorMessage } from '@/lib/points/errors';
import { redeemReward } from '@/app/(household)/rewards/actions';
import type { MemberPointsCache, Reward } from '@/types/database';

export function RewardShelf({
  rewards,
  balances,
  onRedeemed,
}: {
  rewards: Reward[];
  balances: MemberPointsCache[];
  onRedeemed: () => void;
}) {
  const { members } = useMembers();
  const [chosen, setChosen] = useState<Reward | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const balanceOf = (memberId: string) =>
    balances.find((b) => b.member_id === memberId)?.balance ?? 0;

  function redeem(reward: Reward, memberId: string, memberName: string) {
    setError(null);
    startTransition(async () => {
      const result = await redeemReward(memberId, reward.id);
      if ('error' in result) {
        // The RPC re-checks the balance against the ledger, so this is the
        // path that fires when the cached number was stale — which is exactly
        // why the cache is never the gate.
        setError(redeemErrorMessage(result.error, memberName));
      } else {
        setChosen(null);
        onRedeemed();
      }
    });
  }

  if (rewards.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-base font-semibold">Rewards</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nothing to spend points on yet. Add rewards in settings.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-4">
      <h2 className="text-base font-semibold">Rewards</h2>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rewards.map((reward) => {
          // Who could afford it right now — a hint for the UI only.
          const affordable = members.filter((m) => balanceOf(m.id) >= reward.point_cost);
          return (
            <li key={reward.id}>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setChosen(reward);
                }}
                className="flex min-h-[72px] w-full items-center gap-3 rounded-xl border-2 border-slate-200 p-3 text-left"
              >
                <span className="text-2xl" aria-hidden>
                  {reward.emoji || '🎁'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{reward.name}</span>
                  <span className="block text-xs text-slate-500">{reward.point_cost} points</span>
                </span>
                <span className="flex shrink-0 -space-x-2">
                  {affordable.slice(0, 3).map((member) => (
                    <MemberAvatar key={member.id} member={member} size="sm" ring />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Redeeming confirms, unlike ticking a chore: it spends a balance and
          the child should see the cost before it goes (§2.3). */}
      {chosen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-4 sm:rounded-3xl">
            <div className="mb-3 flex items-start gap-3">
              <span className="text-3xl" aria-hidden>
                {chosen.emoji || '🎁'}
              </span>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{chosen.name}</h3>
                <p className="text-sm text-slate-500">{chosen.point_cost} points</p>
                {chosen.description && (
                  <p className="mt-1 text-sm text-slate-600">{chosen.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setChosen(null)}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-400"
              >
                ×
              </button>
            </div>

            <p className="mb-2 text-sm font-medium text-slate-700">Who is spending?</p>
            <ul className="space-y-2">
              {members.map((member) => {
                const balance = balanceOf(member.id);
                const canAfford = balance >= chosen.point_cost;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      disabled={pending || !canAfford}
                      onClick={() => redeem(chosen, member.id, member.display_name)}
                      className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border-2 border-slate-200 px-3 text-left disabled:opacity-40"
                    >
                      <MemberAvatar member={member} size="md" />
                      <span className="flex-1 text-sm font-medium">{member.display_name}</span>
                      <span className="text-sm text-slate-500">
                        {balance} pts
                        {!canAfford && (
                          <span className="block text-xs text-slate-400">
                            needs {chosen.point_cost - balance} more
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
