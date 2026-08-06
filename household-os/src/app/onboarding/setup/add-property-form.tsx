"use client";

import { useActionState, useRef, useEffect } from "react";
import { addPropertyAction } from "@/actions/households";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormError } from "@/components/forms/form-message";

export function AddPropertyForm() {
  const [state, action] = useActionState(addPropertyAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 sm:flex-row">
      <Input name="name" placeholder="Home" required className="flex-1" />
      <Input name="address" placeholder="Address (optional)" className="flex-1" />
      <SubmitButton>Add</SubmitButton>
      <FormError message={state?.error} />
    </form>
  );
}
