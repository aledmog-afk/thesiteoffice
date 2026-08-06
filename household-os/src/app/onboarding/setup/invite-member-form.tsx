"use client";

import { useActionState, useRef, useEffect } from "react";
import { createInviteAction } from "@/actions/invites";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";

export function InviteMemberForm() {
  const [state, action] = useActionState(createInviteAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row">
      <Input name="email" type="email" placeholder="family@example.com" required className="flex-1" />
      <Select name="role" defaultValue="adult">
        <SelectTrigger className="sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="adult">Adult</SelectItem>
          <SelectItem value="child">Child</SelectItem>
        </SelectContent>
      </Select>
      <SubmitButton>Invite</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
