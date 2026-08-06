"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";

export function DeleteIconButton({ onDelete }: { onDelete: () => Promise<void> | void }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Delete"
      disabled={pending}
      onClick={() => startTransition(async () => onDelete())}
      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}
