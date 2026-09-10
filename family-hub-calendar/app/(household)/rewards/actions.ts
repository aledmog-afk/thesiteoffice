'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { currentHouseholdId } from '@/lib/household';
import type { LeaderboardRow } from '@/types/database';

type ActionResult = { ok: true } | { error: string };

export type RewardInput = {
  name: string;
  description: string | null;
  emoji: string | null;
  pointCost: number;
};

function validate(input: RewardInput): string | null {
  if (!input.name.trim()) return 'Give the reward a name.';
  if (input.name.length > 200) return 'That name is too long.';
  if (!Number.isInteger(input.pointCost) || input.pointCost < 1) {
    return 'A reward has to cost at least 1 point.';
  }
  if (input.pointCost > 100000) return 'That cost is unrealistically high.';
  return null;
}

export async function createReward(input: RewardInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const householdId = await currentHouseholdId();

  const { error } = await supabase.from('rewards').insert({
    household_id: householdId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    emoji: input.emoji ? Array.from(input.emoji)[0] : null,
    point_cost: input.pointCost,
    is_active: true,
  });

  if (error) return { error: error.message };
  revalidatePath('/rewards');
  revalidatePath('/settings/rewards');
  return { ok: true };
}

export async function updateReward(rewardId: string, input: RewardInput): Promise<ActionResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  // Changing a cost does not rewrite history: redemptions snapshot
  // point_cost_at_redemption, so past ones keep what they actually cost.
  const { error } = await supabase
    .from('rewards')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      emoji: input.emoji ? Array.from(input.emoji)[0] : null,
      point_cost: input.pointCost,
    })
    .eq('id', rewardId);

  if (error) return { error: error.message };
  revalidatePath('/rewards');
  revalidatePath('/settings/rewards');
  return { ok: true };
}

/** Deactivate rather than delete: reward_redemptions references rewards with
 *  ON DELETE RESTRICT so past redemptions still resolve to a name. */
export async function setRewardActive(
  rewardId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('rewards')
    .update({ is_active: isActive })
    .eq('id', rewardId);

  if (error) return { error: error.message };
  revalidatePath('/rewards');
  revalidatePath('/settings/rewards');
  return { ok: true };
}

/**
 * Spends points. The balance check, the advisory lock and the ledger row all
 * live inside the RPC — nothing here re-implements them, and the client's
 * cached balance is only ever a hint (§2.3).
 */
export async function redeemReward(
  memberId: string,
  rewardId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('redeem_reward', {
    p_member_id: memberId,
    p_reward_id: rewardId,
  });

  // Raised messages are mapped to readable text in the client, which knows the
  // member's name; passing the raw message through keeps that mapping in one
  // place rather than duplicating it server-side.
  if (error) return { error: error.message };

  revalidatePath('/rewards');
  return { ok: true };
}

export async function fulfilRedemption(redemptionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('fulfil_redemption', {
    p_redemption_id: redemptionId,
  });
  if (error) return { error: error.message };
  revalidatePath('/rewards');
  return { ok: true };
}

/** Cancelling refunds via an adjust_up for the snapshotted cost — without
 *  that the points would simply vanish (§2.3). */
export async function cancelRedemption(redemptionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_redemption', {
    p_redemption_id: redemptionId,
  });
  if (error) return { error: error.message };
  revalidatePath('/rewards');
  return { ok: true };
}

export async function fetchLeaderboard(
  fromKey: string,
  toKey: string,
): Promise<{ rows: LeaderboardRow[] } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('leaderboard', {
    p_from: fromKey,
    p_to: toKey,
  });
  if (error) return { error: error.message };
  return { rows: (data ?? []) as LeaderboardRow[] };
}
