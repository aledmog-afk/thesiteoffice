"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/session";

export async function postHouseholdNoteAction(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const { member, household } = await requireMembership();
  const supabase = await createClient();
  await supabase.from("household_notes").insert({
    household_id: household.id,
    author_id: member.user_id,
    body,
  });
  revalidatePath("/dashboard");
}

export async function deleteHouseholdNoteAction(noteId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("household_notes").delete().eq("id", noteId);
  revalidatePath("/dashboard");
}
