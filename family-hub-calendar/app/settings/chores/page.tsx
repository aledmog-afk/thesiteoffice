import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ensureHousehold } from '@/lib/household';
import { ChoreSettingsList } from './ChoreSettingsList';
import { dateKey } from '@/lib/calendar/timezone';

export default async function ChoreSettingsPage() {
  const { household } = await ensureHousehold();
  const supabase = await createClient();

  const { data: chores } = await supabase.from('chores').select('*').order('title');

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/chores" className="text-sm font-medium text-slate-600">
        ← Back to the board
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Chores</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        Instances are generated two weeks ahead, so edits here show up on the board straight away.
      </p>

      <ChoreSettingsList
        chores={chores ?? []}
        todayKey={dateKey(new Date(), household.timezone)}
      />
    </main>
  );
}
