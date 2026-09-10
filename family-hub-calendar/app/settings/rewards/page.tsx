import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ensureHousehold } from '@/lib/household';
import { RewardSettingsList } from './RewardSettingsList';

export default async function RewardSettingsPage() {
  await ensureHousehold();
  const supabase = await createClient();

  const { data: rewards } = await supabase
    .from('rewards')
    .select('*')
    .order('point_cost');

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/rewards" className="text-sm font-medium text-slate-600">
        ← Back to points
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Rewards</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">
        What points can be spent on. Costs are set by the household, not fixed by the app.
      </p>

      <RewardSettingsList rewards={rewards ?? []} />
    </main>
  );
}
