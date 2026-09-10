import { createClient } from '@/lib/supabase/server';
import { ensureHousehold, currentHouseholdId } from '@/lib/household';
import { PointsHub } from '@/components/rewards/PointsHub';
import { dateKey } from '@/lib/calendar/timezone';
import { periodRange } from '@/lib/points/periods';
import type { LeaderboardRow } from '@/types/database';

export default async function RewardsPage() {
  const { household, settings } = await ensureHousehold();
  const householdId = await currentHouseholdId();
  const supabase = await createClient();

  const todayKey = dateKey(new Date(), household.timezone);
  // Seed the default period so the wall display paints a populated board.
  const { fromKey, toKey } = periodRange('week', todayKey, settings.week_starts_on);

  const [rewards, balances, redemptions, board] = await Promise.all([
    supabase.from('rewards').select('*').order('point_cost'),
    supabase.from('member_points_cache').select('*'),
    supabase
      .from('reward_redemptions')
      .select('*')
      .order('redeemed_at', { ascending: false })
      .limit(50),
    supabase.rpc('leaderboard', { p_from: fromKey, p_to: toKey }),
  ]);

  return (
    <PointsHub
      householdId={householdId}
      todayKey={todayKey}
      weekStartsOn={settings.week_starts_on}
      initialRewards={rewards.data ?? []}
      initialBalances={balances.data ?? []}
      initialRedemptions={redemptions.data ?? []}
      initialLeaderboard={(board.data ?? []) as LeaderboardRow[]}
    />
  );
}
