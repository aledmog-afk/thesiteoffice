import { createClient } from '@/lib/supabase/server';
import { ensureHousehold, currentHouseholdId } from '@/lib/household';
import { ChoreBoard } from '@/components/chores/ChoreBoard';
import { addDaysToKey, dateKey, startOfWeekKey } from '@/lib/calendar/timezone';

export default async function ChoresPage() {
  const { household, settings } = await ensureHousehold();
  const householdId = await currentHouseholdId();
  const supabase = await createClient();

  const todayKey = dateKey(new Date(), household.timezone);
  const weekStartKey = startOfWeekKey(todayKey, settings.week_starts_on);
  const weekEndKey = addDaysToKey(weekStartKey, 6);

  const [chores, instances, balances] = await Promise.all([
    supabase.from('chores').select('*').order('title'),
    supabase
      .from('chore_instances')
      .select('*')
      .gte('due_on', weekStartKey)
      .lte('due_on', weekEndKey)
      .order('due_on'),
    supabase.from('member_points_cache').select('*'),
  ]);

  return (
    <div className="h-full">
      <ChoreBoard
        householdId={householdId}
        weekStartKey={weekStartKey}
        todayKey={todayKey}
        chores={chores.data ?? []}
        initialInstances={instances.data ?? []}
        initialBalances={balances.data ?? []}
      />
    </div>
  );
}
