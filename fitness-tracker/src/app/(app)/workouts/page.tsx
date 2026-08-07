import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StartWorkoutForm } from "./start-workout-form";

export default async function WorkoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: workouts } = await supabase
    .from("fitness_workouts")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Workouts</h1>

      <StartWorkoutForm />

      <div className="flex flex-col gap-2">
        {(workouts ?? []).length === 0 && (
          <p className="rounded-xl bg-zinc-100 px-4 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            No workouts yet. Start one above.
          </p>
        )}

        {(workouts ?? []).map((w) => (
          <Link
            key={w.id}
            href={`/workouts/${w.id}`}
            className="flex items-center justify-between rounded-xl bg-white px-4 py-3.5 dark:bg-zinc-900"
          >
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{w.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(w.started_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                w.completed_at
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
              }`}
            >
              {w.completed_at ? "Done" : "In progress"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
