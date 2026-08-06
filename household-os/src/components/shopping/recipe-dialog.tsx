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
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";
import { createRecipeAction } from "@/actions/shopping";

export function RecipeDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(createRecipeAction, undefined);
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
          <DialogTitle>New recipe</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ingredients">Ingredients (one per line)</Label>
            <Textarea id="ingredients" name="ingredients" rows={6} placeholder={"2 cups flour\n1 tsp salt\nMilk"} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source_url">Source link (optional)</Label>
            <Input id="source_url" name="source_url" type="url" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <FormError message={state?.error} />
          <DialogFooter>
            <SubmitButton>Save recipe</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
