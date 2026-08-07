import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkoutDetailClient } from "./workout-detail-client";

export default async function WorkoutDetailPage(props: PageProps<"/workouts/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: workout }, { data: sets }, { data: exercises }] = await Promise.all([
    supabase.from("fitness_workouts").select("*").eq("id", id).single(),
    supabase
      .from("fitness_workout_sets")
      .select("*, fitness_exercises(name, target_muscle_group)")
      .eq("workout_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("fitness_exercises").select("*").order("name", { ascending: true }),
  ]);

  if (!workout) notFound();

  return <WorkoutDetailClient workout={workout} sets={sets ?? []} exercises={exercises ?? []} />;
}
