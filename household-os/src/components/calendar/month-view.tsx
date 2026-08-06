"use client";

import { eachDayOfInterval, isSameDay, isSameMonth, format } from "date-fns";
import { getVisibleRange } from "@/lib/calendar-range";
import { EventDialog } from "./event-dialog";
import { EventChip } from "./event-chip";
import type { CalendarEvent, Member } from "@/lib/types";

type EventWithAssignees = CalendarEvent & { calendar_event_assignees: { member_id: string }[] };

export function MonthView({
  date,
  events,
  members,
  currentMemberId,
}: {
  date: Date;
  events: EventWithAssignees[];
  members: Member[];
  currentMemberId: string;
}) {
  const { gridStart, gridEnd } = getVisibleRange("month", date);
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-sm">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div key={d} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {days.map((day) => {
        const dayEvents = events.filter((e) => isSameDay(new Date(e.starts_at), day));
        const inMonth = isSameMonth(day, date);
        return (
          <div key={day.toISOString()} className={`min-h-24 bg-background p-1 ${inMonth ? "" : "opacity-40"}`}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs">{format(day, "d")}</span>
              <EventDialog members={members} currentMemberId={currentMemberId} defaultDate={day}>
                <button className="text-xs text-muted-foreground hover:text-foreground">+</button>
              </EventDialog>
            </div>
            <div className="space-y-0.5">
              {dayEvents.slice(0, 3).map((event) => (
                <EventChip key={event.id} event={event} members={members} currentMemberId={currentMemberId} />
              ))}
              {dayEvents.length > 3 && (
                <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
