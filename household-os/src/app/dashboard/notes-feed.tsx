"use client";

import { useRef, useTransition } from "react";
import { postHouseholdNoteAction, deleteHouseholdNoteAction } from "@/actions/notes";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/forms/submit-button";
import { X } from "lucide-react";
import type { HouseholdNote, Member } from "@/lib/types";

export function NotesFeed({
  notes,
  memberById,
  currentUserId,
}: {
  notes: HouseholdNote[];
  memberById: Map<string, Member>;
  currentUserId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        action={async (formData) => {
          await postHouseholdNoteAction(formData);
          formRef.current?.reset();
        }}
        className="flex gap-2"
      >
        <Textarea name="body" placeholder="Back Thursday, deep clean before then..." className="min-h-[40px] flex-1" required />
        <SubmitButton size="sm">Post</SubmitButton>
      </form>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const author = [...memberById.values()].find((m) => m.user_id === note.author_id);
            return (
              <li key={note.id} className="group flex items-start justify-between gap-2 text-sm">
                <div>
                  <p>{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {author?.display_name ?? "Someone"} &middot;{" "}
                    {new Date(note.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {note.author_id === currentUserId && (
                  <button
                    type="button"
                    aria-label="Delete note"
                    onClick={() => startTransition(() => deleteHouseholdNoteAction(note.id))}
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
