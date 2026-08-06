"use client";

import { format } from "date-fns";
import { MapPin } from "lucide-react";
import { EventDialog } from "./event-dialog";
import { Button } from "@/components/ui/button";
import type { CalendarEvent, Member } from "@/lib/types";

type EventWithAssignees = CalendarEvent & { calendar_event_assignees: { member_id: string }[] };

export function DayView({
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
  const dayEvents = [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="space-y-2">
      {dayEvents.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing scheduled for {format(date, "EEEE, MMMM d")}.
        </div>
      ) : (
        dayEvents.map((event) => {
          const assignees = members.filter((m) =>
            event.calendar_event_assignees.some((a) => a.member_id === m.id)
          );
          return (
            <EventDialog
              key={event.id}
              members={members}
              currentMemberId={currentMemberId}
              event={event}
              assigneeIds={assignees.map((a) => a.id)}
            >
              <button className="flex w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-accent/50">
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: event.color ?? assignees[0]?.color ?? "var(--color-primary)" }}
                />
                <div className="flex-1">
                  <div className="font-medium">{event.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.all_day
                      ? "All day"
                      : `${new Date(event.starts_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })} – ${new Date(event.ends_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}`}
                  </div>
                  {event.location && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" /> {event.location}
                    </div>
                  )}
                  {assignees.length > 0 && (
                    <div className="mt-1 flex gap-1">
                      {assignees.map((a) => (
                        <span key={a.id} className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ backgroundColor: a.color }}>
                          {a.display_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            </EventDialog>
          );
        })
      )}
      <EventDialog members={members} currentMemberId={currentMemberId} defaultDate={date}>
        <Button variant="outline" className="w-full">
          Add event to this day
        </Button>
      </EventDialog>
    </div>
  );
}
