'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { useTableSubscription } from '@/lib/realtime/useTableSubscription';
import type { ChoreInstance, MemberPointsCache } from '@/types/database';

/**
 * The week's instances plus every member's balance.
 *
 * Balances come from `member_points_cache`, not from summing the ledger in the
 * client: Realtime publishes table changes and not view changes, which is the
 * main reason that projection exists (§2.3). It is display only — the redeem
 * RPC re-checks against the ledger itself, so a drifted cache can show a wrong
 * number but can never authorise an overdraw.
 */
export function useChoreBoard(
  householdId: string,
  fromKey: string,
  toKey: string,
  initialInstances: ChoreInstance[],
  initialBalances: MemberPointsCache[],
) {
  const [instances, setInstances] = useState(initialInstances);
  const [balances, setBalances] = useState(initialBalances);
  const supabase = useMemo(() => createClient(), []);
  const { epoch } = useHouseholdChannel();

  const refetch = useCallback(async () => {
    const [instanceRows, balanceRows] = await Promise.all([
      supabase
        .from('chore_instances')
        .select('*')
        .gte('due_on', fromKey)
        .lte('due_on', toKey)
        .order('due_on'),
      supabase.from('member_points_cache').select('*'),
    ]);
    if (instanceRows.data) setInstances(instanceRows.data);
    if (balanceRows.data) setBalances(balanceRows.data);
  }, [supabase, fromKey, toKey]);

  useEffect(() => {
    void refetch();
  }, [refetch, epoch]);

  // A tick on a phone has to land on the wall tablet in under a second; that
  // visible immediacy is most of why the chart works (§2.3).
  useTableSubscription<ChoreInstance>('chore_instances', householdId, () => {
    void refetch();
  });
  useTableSubscription<MemberPointsCache>('member_points_cache', householdId, () => {
    void refetch();
  });

  const patchInstance = useCallback((id: string, patch: Partial<ChoreInstance>) => {
    setInstances((current) => current.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const balanceFor = useCallback(
    (memberId: string) => balances.find((b) => b.member_id === memberId) ?? null,
    [balances],
  );

  return { instances, balances, balanceFor, patchInstance, refetch };
}
