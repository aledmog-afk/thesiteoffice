"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { revokeInviteAction } from "@/actions/invites";

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(() => revokeInviteAction(inviteId))}
    >
      Revoke
    </Button>
  );
}
