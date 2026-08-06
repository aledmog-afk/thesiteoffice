"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/actions/invites";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInviteAction, undefined);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormError message={state?.error} />
      <SubmitButton className="w-full">Accept invite</SubmitButton>
    </form>
  );
}
