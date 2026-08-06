"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/session";

export type FormState = { error?: string } | undefined;

function parseAssigneeIds(formData: FormData): string[] {
  return formData.getAll("assignee_ids").map(String).filter(Boolean);
}

export async function createEventAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("start_time") ?? "");
  const endTime = String(formData.get("end_time") ?? "");
  const allDay = formData.get("all_day") === "on";
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();

  if (!title || !date) return { error: "Title and date are required." };

  const startsAt = new Date(`${date}T${allDay ? "00:00" : startTime || "09:00"}`);
  const endsAt = new Date(`${date}T${allDay ? "23:59" : endTime || startTime || "10:00"}`);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return { error: "Invalid date or time." };
  }

  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const { data: event, error } = await supabase
    .from("calendar_events")
    .insert({
      household_id: household.id,
      title,
      notes: notes || null,
      location: location || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: allDay,
      color: color || null,
      created_by: member.user_id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  const assigneeIds = parseAssigneeIds(formData);
  if (assigneeIds.length > 0) {
    await supabase
      .from("calendar_event_assignees")
      .insert(assigneeIds.map((memberId) => ({ event_id: event.id, member_id: memberId })));
  }

  revalidatePath("/dashboard/calendar");
}

export async function updateEventAction(eventId: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("start_time") ?? "");
  const endTime = String(formData.get("end_time") ?? "");
  const allDay = formData.get("all_day") === "on";
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();

  if (!title || !date) return { error: "Title and date are required." };

  const startsAt = new Date(`${date}T${allDay ? "00:00" : startTime || "09:00"}`);
  const endsAt = new Date(`${date}T${allDay ? "23:59" : endTime || startTime || "10:00"}`);

  await requireMembership();
  const supabase = await createClient();

  const { error } = await supabase
    .from("calendar_events")
    .update({
      title,
      notes: notes || null,
      location: location || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: allDay,
      color: color || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);

  if (error) return { error: error.message };

  const assigneeIds = parseAssigneeIds(formData);
  await supabase.from("calendar_event_assignees").delete().eq("event_id", eventId);
  if (assigneeIds.length > 0) {
    await supabase
      .from("calendar_event_assignees")
      .insert(assigneeIds.map((memberId) => ({ event_id: eventId, member_id: memberId })));
  }

  revalidatePath("/dashboard/calendar");
}

export async function deleteEventAction(eventId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("calendar_events").delete().eq("id", eventId);
  revalidatePath("/dashboard/calendar");
}
