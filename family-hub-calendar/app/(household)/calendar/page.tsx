import { createClient } from '@/lib/supabase/server';
import { ensureHousehold, currentHouseholdId } from '@/lib/household';
import { CalendarShell } from '@/components/calendar/CalendarShell';
import { addDaysToKey, dateKey, localMidnight, startOfWeekKey } from '@/lib/calendar/timezone';

export default async function CalendarPage() {
  const { household, settings } = await ensureHousehold();
  const householdId = await currentHouseholdId();
  const supabase = await createClient();

  const timeZone = household.timezone;
  const todayKey = dateKey(new Date(), timeZone);

  // Seed the client with the default view's window (the week) so the wall
  // display paints a populated calendar on first render rather than an empty
  // grid that fills in a moment later.
  const weekStart = startOfWeekKey(todayKey, settings.week_starts_on);
  const windowStart = localMidnight(weekStart, timeZone).toISOString();
  const windowEnd = localMidnight(addDaysToKey(weekStart, 7), timeZone).toISOString();

  const [recurring, oneOffs] = await Promise.all([
    supabase.from('events').select('*').or('rrule.not.is.null,recurrence_parent_id.not.is.null'),
    supabase
      .from('events')
      .select('*')
      .is('rrule', null)
      .is('recurrence_parent_id', null)
      .lt('starts_at', windowEnd)
      .gte('ends_at', windowStart),
  ]);

  const merged = new Map((recurring.data ?? []).map((e) => [e.id, e]));
  for (const row of oneOffs.data ?? []) merged.set(row.id, row);

  return (
    <div className="h-full">
      <CalendarShell
        householdId={householdId}
        timeZone={timeZone}
        weekStartsOn={settings.week_starts_on}
        todayKey={todayKey}
        initialEvents={[...merged.values()]}
      />
    </div>
  );
}
