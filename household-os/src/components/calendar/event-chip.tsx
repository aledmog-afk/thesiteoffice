"use client";

import { EventDialog } from "./event-dialog";
import type { CalendarEvent, Member } from "@/lib/types";

type EventWithAssignees = CalendarEvent & { calendar_event_assignees: { member_id: string }[] };

export function EventChip({
  event,
  members,
  currentMemberId,
}: {
  event: EventWithAssignees;
  members: Member[];
  currentMemberId: string;
}) {
  const assigneeIds = event.calendar_event_assignees.map((a) => a.member_id);
  const color = event.color ?? members.find((m) => assigneeIds.includes(m.id))?.color ?? "var(--color-primary)";

  return (
    <EventDialog
      members={members}
      currentMemberId={currentMemberId}
      event={event}
      assigneeIds={assigneeIds}
    >
      <button
        className="block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-white"
        style={{ backgroundColor: color }}
        title={event.title}
      >
        {event.all_day ? "" : `${new Date(event.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} `}
        {event.title}
      </button>
    </EventDialog>
  );
}
