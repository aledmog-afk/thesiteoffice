"use client";

import { useActionState } from "react";
import { createWorkout, type WorkoutFormState } from "./actions";

const initialState: WorkoutFormState = { error: null };

export function StartWorkoutForm() {
  const [state, formAction, pending] = useActionState(createWorkout, initialState);

  return (
    <form action={formAction} className="flex gap-2">
      <input
        name="name"
        placeholder="e.g. Push Day"
        required
        className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start"}
      </button>
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    </form>
  );
}
