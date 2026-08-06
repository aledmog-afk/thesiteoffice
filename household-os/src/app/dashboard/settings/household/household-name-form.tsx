"use client";

import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/forms/submit-button";
import { updateHouseholdNameAction } from "@/actions/households";

export function HouseholdNameForm({ defaultName }: { defaultName: string }) {
  return (
    <form action={updateHouseholdNameAction} className="flex gap-2">
      <Input name="name" defaultValue={defaultName} required className="flex-1" />
      <SubmitButton size="sm">Save</SubmitButton>
    </form>
  );
}
