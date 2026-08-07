"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type WorkoutFormState = { error: string | null };

export async function createWorkout(
  _prevState: WorkoutFormState,
  formData: FormData
): Promise<WorkoutFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Give the workout a name." };
  }

  const { data, error } = await supabase
    .from("fitness_workouts")
    .insert({ user_id: user.id, name })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Could not create workout." };
  }

  revalidatePath("/workouts");
  redirect(`/workouts/${data.id}`);
}

export async function addSet(workoutId: string, formData: FormData) {
  const supabase = await createClient();

  const exerciseId = String(formData.get("exerciseId") ?? "");
  const setNumber = Number(formData.get("setNumber"));
  const weightKg = formData.get("weightKg");
  const reps = formData.get("reps");

  if (!exerciseId || !Number.isFinite(setNumber)) return;

  await supabase.from("fitness_workout_sets").insert({
    workout_id: workoutId,
    exercise_id: exerciseId,
    set_number: setNumber,
    weight_kg: weightKg ? Number(weightKg) : null,
    reps: reps ? Number(reps) : null,
  });

  revalidatePath(`/workouts/${workoutId}`);
}

export async function deleteSet(workoutId: string, setId: string) {
  const supabase = await createClient();
  await supabase.from("fitness_workout_sets").delete().eq("id", setId);
  revalidatePath(`/workouts/${workoutId}`);
}

export async function completeWorkout(workoutId: string) {
  const supabase = await createClient();
  await supabase
    .from("fitness_workouts")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", workoutId);
  revalidatePath(`/workouts/${workoutId}`);
  revalidatePath("/workouts");
}
