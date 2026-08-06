"use client";

import { useActionState } from "react";
import { createHouseholdAction } from "@/actions/households";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";

export function CreateHouseholdForm() {
  const [state, action] = useActionState(createHouseholdAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="household_name">Household name</Label>
        <Input id="household_name" name="household_name" placeholder="The Smith Family" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="display_name">Your display name</Label>
        <Input id="display_name" name="display_name" placeholder="Mom, Dad, Alex..." required />
      </div>
      <FormError message={state?.error} />
      <SubmitButton className="w-full">Create household</SubmitButton>
    </form>
  );
}
