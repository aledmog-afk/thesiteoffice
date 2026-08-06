"use client";

import { eachDayOfInterval, isSameDay, isToday, format } from "date-fns";
import { getVisibleRange } from "@/lib/calendar-range";
import { EventDialog } from "./event-dialog";
import { EventChip } from "./event-chip";
import { cn } from "@/lib/utils";
import type { CalendarEvent, Member } from "@/lib/types";

type EventWithAssignees = CalendarEvent & { calendar_event_assignees: { member_id: string }[] };

export function WeekView({
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
  const { gridStart, gridEnd } = getVisibleRange("week", date);
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
      {days.map((day) => {
        const dayEvents = events
          .filter((e) => isSameDay(new Date(e.starts_at), day))
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        return (
          <div key={day.toISOString()} className="rounded-md border p-2">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">{format(day, "EEE")}</div>
                <div className={cn("text-sm font-semibold", isToday(day) && "text-primary")}>
                  {format(day, "MMM d")}
                </div>
              </div>
              <EventDialog members={members} currentMemberId={currentMemberId} defaultDate={day}>
                <button className="text-xs text-muted-foreground hover:text-foreground">+</button>
              </EventDialog>
            </div>
            <div className="space-y-1">
              {dayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events</p>
              ) : (
                dayEvents.map((event) => (
                  <EventChip key={event.id} event={event} members={members} currentMemberId={currentMemberId} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
