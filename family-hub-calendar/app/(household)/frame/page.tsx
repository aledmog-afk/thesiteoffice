import { createClient } from '@/lib/supabase/server';
import { ensureHousehold } from '@/lib/household';
import { FrameShell } from './FrameShell';
import { expandOccurrences } from '@/lib/calendar/occurrences';
import { HOUSEHOLD_COLOR } from '@/lib/palette';
import { dateKey, localMidnight, addDaysToKey, toTimeInput } from '@/lib/calendar/timezone';

export default async function FramePage() {
  const { household } = await ensureHousehold();
  const supabase = await createClient();
  const timeZone = household.timezone;

  const todayKey = dateKey(new Date(), timeZone);
  const windowStart = localMidnight(todayKey, timeZone);
  const windowEnd = localMidnight(addDaysToKey(todayKey, 2), timeZone);

  const [recurring, oneOffs, members] = await Promise.all([
    supabase.from('events').select('*').or('rrule.not.is.null,recurrence_parent_id.not.is.null'),
    supabase
      .from('events')
      .select('*')
      .is('rrule', null)
      .is('recurrence_parent_id', null)
      .lt('starts_at', windowEnd.toISOString())
      .gte('ends_at', windowStart.toISOString()),
    supabase.from('family_members').select('id, color').eq('is_active', true),
  ]);

  const merged = new Map((recurring.data ?? []).map((e) => [e.id, e]));
  for (const row of oneOffs.data ?? []) merged.set(row.id, row);

  const now = Date.now();
  const upcoming = expandOccurrences([...merged.values()], windowStart, windowEnd, timeZone)
    .filter((o) => o.end.getTime() >= now)
    .at(0);

  const colorById = new Map((members.data ?? []).map((m) => [m.id, m.color]));

  const nextEvent = upcoming
    ? {
        title: upcoming.title,
        when: upcoming.allDay
          ? 'Today'
          : dateKey(upcoming.start, timeZone) === todayKey
            ? toTimeInput(upcoming.start, timeZone)
            : `Tomorrow ${toTimeInput(upcoming.start, timeZone)}`,
        color: (upcoming.memberId && colorById.get(upcoming.memberId)) || HOUSEHOLD_COLOR,
      }
    : null;

  return <FrameShell timeZone={timeZone} nextEvent={nextEvent} />;
}
