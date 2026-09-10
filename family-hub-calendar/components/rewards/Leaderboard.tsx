'use client';

import { useEffect, useState, useTransition } from 'react';
import { MemberAvatar } from '@/components/members/MemberAvatar';
import { useMembers } from '@/components/members/MemberProvider';
import { PERIODS, periodRange, type PeriodKind } from '@/lib/points/periods';
import { fetchLeaderboard } from '@/app/(household)/rewards/actions';
import type { LeaderboardRow } from '@/types/database';

/**
 * Ranks by points *earned* in the period, not by balance — a leaderboard that
 * drops when you spend stops children spending, which defeats the rewards
 * model (§2.3). The balance is shown alongside so both facts are visible.
 */
export function Leaderboard({
  todayKey,
  weekStartsOn,
  initialRows,
  refreshKey,
}: {
  todayKey: string;
  weekStartsOn: number;
  initialRows: LeaderboardRow[];
  /** Bumped by the parent when the ledger changes. The leaderboard is a SQL
   *  function, so Realtime cannot publish it — it has to be re-run. */
  refreshKey: number;
}) {
  const { byId } = useMembers();
  const [period, setPeriod] = useState<PeriodKind>('week');
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Skip only the very first render for the seeded default period; any
    // refreshKey bump must re-run even for 'week', or a redemption would leave
    // a stale board.
    if (period === 'week' && refreshKey === 0) {
      setRows(initialRows);
      return;
    }

    const { fromKey, toKey } = periodRange(period, todayKey, weekStartsOn);
    startTransition(async () => {
      const result = await fetchLeaderboard(fromKey, toKey);
      if ('error' in result) setError(result.error);
      else {
        setError(null);
        setRows(result.rows);
      }
    });
  }, [period, todayKey, weekStartsOn, initialRows, refreshKey]);

  const top = rows[0]?.earned ?? 0;

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-semibold">Leaderboard</h2>
        <div className="flex gap-1">
          {PERIODS.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setPeriod(option.kind)}
              aria-current={period === option.kind ? 'true' : undefined}
              className={`min-h-[44px] rounded-xl px-3 text-xs font-medium ${
                period === option.kind ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <ol className={`mt-3 space-y-2 ${pending ? 'opacity-60' : ''}`}>
        {rows.map((row) => {
          const member = byId.get(row.member_id);
          // Ties share a rank_position (SQL `rank()`), so the number is shown
          // rather than the list index.
          return (
            <li key={row.member_id} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-sm font-bold text-slate-400">
                {row.rank_position}
              </span>
              {member ? (
                <MemberAvatar member={member} size="md" />
              ) : (
                <span className="h-11 w-11 shrink-0 rounded-full bg-slate-200" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{row.display_name}</span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${top > 0 ? Math.round((row.earned / top) * 100) : 0}%`,
                      backgroundColor: row.color,
                    }}
                  />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold">{row.earned}</span>
                <span className="block text-xs text-slate-400">{row.balance} left</span>
              </span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="py-4 text-center text-sm text-slate-500">No points earned yet.</li>
        )}
      </ol>
    </section>
  );
}
