"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireAdult } from "@/lib/session";
import { parseRecurrence, computeNextDueDate } from "@/lib/recurrence";
import { nextRotationAssignee } from "@/lib/rotation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Task } from "@/lib/types";

export type FormState = { error?: string } | undefined;

export async function createTaskAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "");
  const assigneeId = String(formData.get("assignee_member_id") ?? "");
  const points = Number(formData.get("points") ?? 0) || 0;

  if (!title) return { error: "Give the task a title." };

  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").insert({
    household_id: household.id,
    title,
    notes: notes || null,
    due_date: dueDate || null,
    assignee_member_id: assigneeId || null,
    points,
    created_by: member.user_id,
  });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/tasks");
}

export async function deleteTaskAction(taskId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);
  revalidatePath("/dashboard/tasks");
}

async function regenerateFromRoutine(
  supabase: SupabaseClient<Database>,
  routineId: string,
  householdId: string
) {
  const { data: routine } = await supabase
    .from("routines")
    .select("*")
    .eq("id", routineId)
    .single();
  if (!routine || !routine.active) return;

  const { memberId, nextIndex } = nextRotationAssignee(
    routine.rotation_member_ids,
    routine.rotation_index
  );
  const nextDue = computeNextDueDate(routine.recurrence_rule, new Date());

  await supabase
    .from("routines")
    .update({ rotation_index: nextIndex, next_due_date: nextDue.toISOString().slice(0, 10) })
    .eq("id", routine.id);

  await supabase.from("tasks").insert({
    household_id: householdId,
    routine_id: routine.id,
    title: routine.title,
    notes: routine.notes,
    assignee_member_id: memberId,
    due_date: routine.next_due_date,
    points: routine.points,
    created_by: routine.created_by,
  });
}

/** Adults/owners complete-and-approve in one step; children request approval. */
export async function completeTaskAction(taskId: string) {
  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).single<Task>();
  if (!task || task.status !== "open") return;

  if (member.role === "child") {
    if (task.assignee_member_id !== member.id) return;
    await supabase
      .from("tasks")
      .update({
        status: "pending_approval",
        completed_by: member.user_id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
    revalidatePath("/dashboard/tasks");
    return;
  }

  await supabase
    .from("tasks")
    .update({
      status: "done",
      completed_by: member.user_id,
      completed_at: new Date().toISOString(),
      approved_by: member.user_id,
    })
    .eq("id", taskId);

  if (task.assignee_member_id && task.points > 0) {
    await awardPoints(supabase, task.assignee_member_id, task.points);
  }

  if (task.routine_id) {
    await regenerateFromRoutine(supabase, task.routine_id, household.id);
  }

  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/tasks/leaderboard");
}

async function awardPoints(supabase: SupabaseClient<Database>, memberId: string, amount: number) {
  const { data: m } = await supabase
    .from("household_members")
    .select("points")
    .eq("id", memberId)
    .single();
  if (m) {
    await supabase.from("household_members").update({ points: m.points + amount }).eq("id", memberId);
  }
}

export async function approveTaskAction(taskId: string) {
  const { member, household } = await requireAdult();
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).single<Task>();
  if (!task || task.status !== "pending_approval") return;

  await supabase
    .from("tasks")
    .update({ status: "done", approved_by: member.user_id })
    .eq("id", taskId);

  if (task.assignee_member_id && task.points > 0) {
    await awardPoints(supabase, task.assignee_member_id, task.points);
  }

  if (task.routine_id) {
    await regenerateFromRoutine(supabase, task.routine_id, household.id);
  }

  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard/tasks/leaderboard");
}

export async function createRoutineAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const recurrenceInput = String(formData.get("recurrence") ?? "").trim();
  const points = Number(formData.get("points") ?? 5) || 5;
  const rotationIds = formData.getAll("rotation_member_ids").map(String).filter(Boolean);

  if (!title) return { error: "Give the routine a title." };
  if (!recurrenceInput) return { error: 'Describe how often, e.g. "every 90 days" or "every Monday".' };

  const parsed = parseRecurrence(recurrenceInput);
  if (!parsed) {
    return {
      error: `Couldn't understand "${recurrenceInput}". Try things like "daily", "every Monday", or "every 90 days".`,
    };
  }

  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const { data: routine, error } = await supabase
    .from("routines")
    .insert({
      household_id: household.id,
      title,
      notes: notes || null,
      recurrence_rule: parsed.rule,
      recurrence_text: parsed.recurrenceText,
      rotation_member_ids: rotationIds,
      rotation_index: 0,
      points,
      next_due_date: parsed.nextDueDate.toISOString().slice(0, 10),
      created_by: member.user_id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  const { memberId, nextIndex } = nextRotationAssignee(rotationIds, 0);
  await supabase.from("routines").update({ rotation_index: nextIndex }).eq("id", routine.id);

  await supabase.from("tasks").insert({
    household_id: household.id,
    routine_id: routine.id,
    title: routine.title,
    notes: routine.notes,
    assignee_member_id: memberId,
    due_date: routine.next_due_date,
    points: routine.points,
    created_by: member.user_id,
  });

  revalidatePath("/dashboard/tasks");
}

export async function deleteRoutineAction(routineId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("routines").update({ active: false }).eq("id", routineId);
  revalidatePath("/dashboard/tasks");
}
