'use client';

import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { useHouseholdChannel } from '@/lib/realtime/HouseholdChannelProvider';

export function RosterStrip() {
  const { members } = useMembers();
  const { state } = useHouseholdChannel();

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Family</h2>
        {/* A kiosk that has silently stopped receiving updates looks identical
            to one that is simply quiet, so the state is always on screen. */}
        <span
          className={`text-xs font-medium ${
            state === 'live' ? 'text-emerald-600' : 'text-amber-600'
          }`}
        >
          {state === 'live' ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {members.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No family members yet. Add them in Settings and they appear here instantly.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-5">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col items-center gap-2">
              <MemberAvatar member={member} size="xl" />
              <span className="text-base font-medium">{member.display_name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
