'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';
import { useTableSubscription } from '@/lib/realtime/useTableSubscription';
import { HOUSEHOLD_COLOR } from '@/lib/palette';
import type { FamilyMember } from '@/types/database';

interface MemberContextValue {
  members: FamilyMember[];
  byId: Map<string, FamilyMember>;
  colorFor: (memberId: string | null | undefined) => string;
  refetch: () => Promise<void>;
}

const Ctx = createContext<MemberContextValue | null>(null);

// §2.1: the roster is loaded once here and every feature reads colours from it
// rather than joining family_members into its own queries. Seeded from the
// server render so the wall display never flashes uncoloured events.
export function MemberProvider({
  householdId,
  initialMembers,
  children,
}: {
  householdId: string;
  initialMembers: FamilyMember[];
  children: ReactNode;
}) {
  const [members, setMembers] = useState(initialMembers);
  const supabase = useMemo(() => createClient(), []);
  const { epoch } = useHouseholdChannel();

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('family_members')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('display_name');
    if (data) setMembers(data);
  }, [supabase]);

  // Realtime carries the common case; the epoch covers what it cannot (missed
  // changes while the socket was down, tablet returning to the foreground).
  useTableSubscription<FamilyMember>('family_members', householdId, () => {
    void refetch();
  });

  useEffect(() => {
    if (epoch > 0) void refetch();
  }, [epoch, refetch]);

  const value = useMemo<MemberContextValue>(() => {
    const byId = new Map(members.map((m) => [m.id, m]));
    return {
      members,
      byId,
      // NULL member_id means "everyone" (§2.2), which renders neutral rather
      // than borrowing some member's colour.
      colorFor: (id) => (id ? byId.get(id)?.color ?? HOUSEHOLD_COLOR : HOUSEHOLD_COLOR),
      refetch,
    };
  }, [members, refetch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMembers() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMembers must be used inside MemberProvider');
  return ctx;
}

export function useMember(id: string | null | undefined) {
  const { byId } = useMembers();
  return id ? byId.get(id) ?? null : null;
}
