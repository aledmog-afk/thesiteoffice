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
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";
import { createRoutineAction } from "@/actions/tasks";
import type { Member } from "@/lib/types";

export function RoutineDialog({ children, members }: { children: React.ReactNode; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(createRoutineAction, undefined);
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
          <DialogTitle>New recurring routine</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Change the furnace filter" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recurrence">Repeats</Label>
            <Input id="recurrence" name="recurrence" placeholder="every 90 days" required />
            <p className="text-xs text-muted-foreground">
              Try &quot;daily&quot;, &quot;every Monday&quot;, &quot;every 2 weeks&quot;, or &quot;every 90 days&quot;.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="points">Points per completion</Label>
            <Input id="points" name="points" type="number" min={0} defaultValue={5} />
          </div>
          <div className="space-y-1.5">
            <Label>Rotate between</Label>
            <p className="text-xs text-muted-foreground">
              Selected members take turns each cycle. Leave empty to assign no one automatically.
            </p>
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox name="rotation_member_ids" value={m.id} />
                  {m.display_name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <FormError message={state?.error} />
          <DialogFooter>
            <SubmitButton>Create routine</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
