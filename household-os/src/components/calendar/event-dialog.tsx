"use client";

import { useActionState, useState, useEffect, useRef, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";
import { createEventAction, updateEventAction, deleteEventAction } from "@/actions/events";
import { toDateParam } from "@/lib/calendar-range";
import type { Member, CalendarEvent } from "@/lib/types";

export function EventDialog({
  children,
  members,
  currentMemberId,
  defaultDate,
  event,
  assigneeIds = [],
}: {
  children: React.ReactNode;
  members: Member[];
  currentMemberId: string;
  defaultDate?: Date;
  event?: CalendarEvent;
  assigneeIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const boundAction = event ? updateEventAction.bind(null, event.id) : createEventAction;
  const [state, action, isPending] = useActionState(boundAction, undefined);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [isDeleting, startDelete] = useTransition();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending && !state?.error) {
      setOpen(false);
    }
    wasPending.current = isPending;
  }, [isPending, state]);

  const startDate = event ? new Date(event.starts_at) : defaultDate ?? new Date();
  const endDate = event ? new Date(event.ends_at) : defaultDate ?? new Date();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={event?.title} required />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="all_day" name="all_day" checked={allDay} onCheckedChange={setAllDay} />
            <Label htmlFor="all_day">All day</Label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={toDateParam(startDate)} required />
            </div>
            {!allDay && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="start_time">Start</Label>
                  <Input
                    id="start_time"
                    name="start_time"
                    type="time"
                    defaultValue={event ? startDate.toTimeString().slice(0, 5) : "09:00"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end_time">End</Label>
                  <Input
                    id="end_time"
                    name="end_time"
                    type="time"
                    defaultValue={event ? endDate.toTimeString().slice(0, 5) : "10:00"}
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={event?.location ?? ""} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" defaultValue={event?.notes ?? ""} />
          </div>

          <div className="space-y-1.5">
            <Label>Assigned to</Label>
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    name="assignee_ids"
                    value={m.id}
                    defaultChecked={
                      event ? assigneeIds.includes(m.id) : m.id === currentMemberId
                    }
                  />
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>

          <input type="hidden" name="color" value={members.find((m) => m.id === currentMemberId)?.color ?? ""} />

          <FormError message={state?.error} />

          <DialogFooter className="gap-2">
            {event && (
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() =>
                  startDelete(async () => {
                    await deleteEventAction(event.id);
                    setOpen(false);
                  })
                }
              >
                Delete
              </Button>
            )}
            <SubmitButton>{event ? "Save" : "Create"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
