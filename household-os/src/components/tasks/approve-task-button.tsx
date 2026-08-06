"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveTaskAction } from "@/actions/tasks";

export function ApproveTaskButton({ taskId }: { taskId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() => startTransition(() => approveTaskAction(taskId))}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      Approve
    </Button>
  );
}
