"use client";

import { useActionState } from "react";
import { logIn } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(logIn, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <FormError message={state?.error} />
      <SubmitButton className="w-full">Log in</SubmitButton>
    </form>
  );
}
