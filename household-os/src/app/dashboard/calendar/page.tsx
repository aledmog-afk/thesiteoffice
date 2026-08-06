import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getVisibleRange, parseDateParam, type CalendarViewKind } from "@/lib/calendar-range";
import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import { DayView } from "@/components/calendar/day-view";
import type { CalendarEvent } from "@/lib/types";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { view: rawView, date: rawDate } = await searchParams;
  const view: CalendarViewKind = rawView === "week" || rawView === "day" ? rawView : "month";
  const date = parseDateParam(rawDate);
  const { gridStart, gridEnd } = getVisibleRange(view, date);

  const { household, member } = await requireMembership();
  const supabase = await createClient();

  const [{ data: events }, { data: members }, { data: feedToken }] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("*, calendar_event_assignees(member_id)")
      .eq("household_id", household.id)
      .gte("starts_at", gridStart.toISOString())
      .lte("starts_at", gridEnd.toISOString())
      .order("starts_at"),
    supabase.from("household_members").select("*").eq("household_id", household.id),
    supabase.from("calendar_feed_tokens").select("token").eq("household_id", household.id).maybeSingle(),
  ]);

  const eventsList = (events ?? []) as (CalendarEvent & {
    calendar_event_assignees: { member_id: string }[];
  })[];

  return (
    <div className="flex flex-1 flex-col p-4 sm:p-6">
      <CalendarToolbar
        view={view}
        date={date}
        members={members ?? []}
        currentMemberId={member.id}
        feedToken={feedToken?.token}
      />
      {view === "month" && (
        <MonthView date={date} events={eventsList} members={members ?? []} currentMemberId={member.id} />
      )}
      {view === "week" && (
        <WeekView date={date} events={eventsList} members={members ?? []} currentMemberId={member.id} />
      )}
      {view === "day" && (
        <DayView date={date} events={eventsList} members={members ?? []} currentMemberId={member.id} />
      )}
    </div>
  );
}
