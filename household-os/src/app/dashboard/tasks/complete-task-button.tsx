"use client";

import { useTransition } from "react";
import { Circle, Loader2 } from "lucide-react";
import { completeTaskAction } from "@/actions/tasks";
import { cn } from "@/lib/utils";

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Mark task complete"
      disabled={pending}
      onClick={() => startTransition(() => completeTaskAction(taskId))}
      className={cn("shrink-0 text-muted-foreground transition-colors hover:text-primary")}
    >
      {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Circle className="h-5 w-5" />}
    </button>
  );
}
