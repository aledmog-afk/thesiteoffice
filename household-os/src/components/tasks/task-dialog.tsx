"use client";

import { useActionState, useState, useEffect, useRef } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";
import { createTaskAction } from "@/actions/tasks";
import type { Member } from "@/lib/types";

export function TaskDialog({ children, members }: { children: React.ReactNode; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(createTaskAction, undefined);
  const wasPending = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (wasPending.current && !isPending && !state?.error) {
      setOpen(false);
      formRef.current?.reset();
    }
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="due_date">Due date</Label>
              <Input id="due_date" name="due_date" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="points">Points</Label>
              <Input id="points" name="points" type="number" min={0} defaultValue={0} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assignee_member_id">Assign to</Label>
            <Select name="assignee_member_id">
              <SelectTrigger id="assignee_member_id">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <FormError message={state?.error} />
          <DialogFooter>
            <SubmitButton>Create task</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
