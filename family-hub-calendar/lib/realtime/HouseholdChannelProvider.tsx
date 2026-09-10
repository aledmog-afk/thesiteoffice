'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface HouseholdChannelValue {
  channel: RealtimeChannel | null;
  state: ConnectionState;
  /** Bumped on every (re)subscribe. Features refetch when this changes, because
   *  Realtime does not replay changes missed while the socket was down. */
  epoch: number;
}

const Ctx = createContext<HouseholdChannelValue>({
  channel: null,
  state: 'connecting',
  epoch: 0,
});

// §Cross-cutting: ONE channel per household, not one per component. The display
// dashboard shows calendar + chores + weather at once, and per-component
// channels would multiply subscriptions for no benefit.
export function HouseholdChannelProvider({
  householdId,
  children,
}: {
  householdId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [epoch, setEpoch] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const hasConnectedRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const channel = supabase.channel(`household:${householdId}`, {
      config: { private: false },
    });
    channelRef.current = channel;

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setState('live');
        // First subscribe needs no refetch (the server render is fresh); every
        // later one does, so only bump the epoch on reconnect.
        if (hasConnectedRef.current) setEpoch((n) => n + 1);
        hasConnectedRef.current = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setState('reconnecting');
      }
    });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [supabase, householdId]);

  // A wall tablet left open for weeks drifts. Refetch when it comes back to the
  // foreground, and on a 15-minute floor, independently of socket health.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setEpoch((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => setEpoch((n) => n + 1), 15 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, []);

  const value = useMemo<HouseholdChannelValue>(
    () => ({ channel: channelRef.current, state, epoch }),
    [state, epoch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useHouseholdChannel = () => useContext(Ctx);
