'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { useTableSubscription } from '@/lib/realtime/useTableSubscription';
import { Leaderboard } from './Leaderboard';
import { RewardShelf } from './RewardShelf';
import { RedemptionQueue } from './RedemptionQueue';
import type {
  LeaderboardRow,
  MemberPointsCache,
  Reward,
  RewardRedemption,
} from '@/types/database';

export function PointsHub({
  householdId,
  todayKey,
  weekStartsOn,
  initialRewards,
  initialBalances,
  initialRedemptions,
  initialLeaderboard,
}: {
  householdId: string;
  todayKey: string;
  weekStartsOn: number;
  initialRewards: Reward[];
  initialBalances: MemberPointsCache[];
  initialRedemptions: RewardRedemption[];
  initialLeaderboard: LeaderboardRow[];
}) {
  const [balances, setBalances] = useState(initialBalances);
  const [redemptions, setRedemptions] = useState(initialRedemptions);
  // The leaderboard is a SQL function and owns its own period, so it refetches
  // itself when this bumps rather than being fed rows from here.
  const [refreshKey, setRefreshKey] = useState(0);
  const supabase = useMemo(() => createClient(), []);
  const { epoch } = useHouseholdChannel();

  const refetch = useCallback(async () => {
    const [balanceRows, redemptionRows] = await Promise.all([
      supabase.from('member_points_cache').select('*'),
      supabase
        .from('reward_redemptions')
        .select('*')
        .order('redeemed_at', { ascending: false })
        .limit(50),
    ]);
    if (balanceRows.data) setBalances(balanceRows.data);
    if (redemptionRows.data) setRedemptions(redemptionRows.data);
    setRefreshKey((n) => n + 1);
  }, [supabase]);

  // member_points_cache is the projection Realtime can actually publish, so a
  // redemption on a phone updates every device's balances (§2.3).
  useTableSubscription<MemberPointsCache>('member_points_cache', householdId, () => {
    void refetch();
  });

  useEffect(() => {
    if (epoch > 0) void refetch();
  }, [epoch, refetch]);

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">Points</h1>
        <Link
          href="/settings/rewards"
          className="flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-slate-600"
        >
          Manage rewards
        </Link>
      </div>

      <RedemptionQueue
        redemptions={redemptions}
        rewards={initialRewards}
        onChanged={() => void refetch()}
      />

      <Leaderboard
        todayKey={todayKey}
        weekStartsOn={weekStartsOn}
        initialRows={initialLeaderboard}
        refreshKey={refreshKey}
      />

      <RewardShelf
        rewards={initialRewards.filter((r) => r.is_active)}
        balances={balances}
        onRedeemed={() => void refetch()}
      />
    </main>
  );
}
