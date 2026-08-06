"use client";

import { useActionState } from "react";
import { signUp } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError, FormInfo } from "@/components/forms/form-message";

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/onboarding"} />
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Your name</Label>
        <Input id="full_name" name="full_name" required autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <FormError message={state?.error} />
      <FormInfo message={state?.info} />
      <SubmitButton className="w-full">Create account</SubmitButton>
    </form>
  );
}
