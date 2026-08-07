"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import type { Exercise, Workout, WorkoutSet } from "@/lib/supabase/database.types";
import { addSet, completeWorkout, deleteSet } from "../actions";

type WorkoutSetWithExercise = WorkoutSet & {
  fitness_exercises: { name: string; target_muscle_group: string | null } | null;
};

export function WorkoutDetailClient({
  workout,
  sets,
  exercises,
}: {
  workout: Workout;
  sets: WorkoutSetWithExercise[];
  exercises: Exercise[];
}) {
  const [selectedExerciseId, setSelectedExerciseId] = useState(exercises[0]?.id ?? "");
  const [pending, setPending] = useState(false);

  const nextSetNumber = useMemo(() => {
    const countForExercise = sets.filter((s) => s.exercise_id === selectedExerciseId).length;
    return countForExercise + 1;
  }, [sets, selectedExerciseId]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutSetWithExercise[]>();
    for (const s of sets) {
      const key = s.fitness_exercises?.name ?? "Unknown exercise";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return Array.from(map.entries());
  }, [sets]);

  async function handleAddSet(formData: FormData) {
    setPending(true);
    await addSet(workout.id, formData);
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link href="/workouts" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900">
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{workout.name}</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {new Date(workout.started_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      {!workout.completed_at && exercises.length > 0 && (
        <form
          action={handleAddSet}
          className="flex flex-col gap-3 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900"
        >
          <select
            name="exerciseId"
            value={selectedExerciseId}
            onChange={(e) => setSelectedExerciseId(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          >
            {exercises.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>

          <input type="hidden" name="setNumber" value={nextSetNumber} />

          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center justify-center rounded-lg bg-white px-2 py-2 text-sm font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              Set {nextSetNumber}
            </div>
            <input
              name="weightKg"
              type="number"
              step="0.5"
              min={0}
              placeholder="kg"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
            <input
              name="reps"
              type="number"
              min={0}
              placeholder="reps"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Logging…" : "Log set"}
          </button>
        </form>
      )}

      <div className="flex flex-col gap-4">
        {grouped.length === 0 && (
          <p className="rounded-xl bg-zinc-100 px-4 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            No sets logged yet.
          </p>
        )}

        {grouped.map(([exerciseName, exerciseSets]) => (
          <div key={exerciseName}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {exerciseName}
            </h3>
            <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {exerciseSets.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="text-sm text-zinc-900 dark:text-zinc-50">
                    Set {s.set_number} — {s.weight_kg ?? "–"} kg × {s.reps ?? "–"} reps
                  </p>
                  {!workout.completed_at && (
                    <button
                      onClick={() => deleteSet(workout.id, s.id)}
                      aria-label="Delete set"
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {!workout.completed_at ? (
        <button
          onClick={() => completeWorkout(workout.id)}
          className="rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Finish workout
        </button>
      ) : (
        <p className="text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Workout completed
        </p>
      )}
    </div>
  );
}
