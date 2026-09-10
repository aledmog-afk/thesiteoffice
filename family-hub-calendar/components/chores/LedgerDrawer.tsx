'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import type { FamilyMember, PointsLedgerEntry } from '@/types/database';

const LABELS: Record<string, string> = {
  earn: 'Earned',
  redeem: 'Spent',
  adjust_up: 'Added',
  adjust_down: 'Removed',
};

/**
 * The visible payoff of the ledger model, and how "that's not fair" arguments
 * get settled (§2.3). Reads points_ledger directly — the client has SELECT on
 * it, and only SELECT.
 */
export function LedgerDrawer({
  member,
  balance,
  onClose,
}: {
  member: FamilyMember;
  balance: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<PointsLedgerEntry[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void supabase
      .from('points_ledger')
      .select('*')
      .eq('member_id', member.id)
      .order('occurred_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) setEntries(data ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [member.id]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl">
        <div className="mb-4 flex items-center gap-3">
          <MemberAvatar member={member} size="lg" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{member.display_name}</h2>
            <p className="text-sm text-slate-500">{balance} points</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-400"
          >
            ×
          </button>
        </div>

        {entries === null ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No points yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.note || LABELS[entry.direction] || entry.direction}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {new Date(entry.occurred_at).toLocaleDateString()} ·{' '}
                    {LABELS[entry.direction] ?? entry.direction}
                  </span>
                </span>
                <span
                  className={`text-sm font-semibold ${
                    entry.signed_amount > 0 ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {entry.signed_amount > 0 ? '+' : ''}
                  {entry.signed_amount}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Corrections are recorded as extra entries, never edits — the running total is always the
          sum of this list.
        </p>
      </div>
    </div>
  );
}
