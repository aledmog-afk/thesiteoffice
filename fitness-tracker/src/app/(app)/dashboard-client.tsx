"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { MacroRings } from "@/components/macro-rings";
import type { FoodEntry, MealCategory } from "@/lib/supabase/database.types";
import { addFoodEntry, deleteFoodEntry, type FoodFormState } from "./food-actions";

const CATEGORIES: MealCategory[] = ["Breakfast", "Lunch", "Dinner", "Snack"];
const initialState: FoodFormState = { error: null };

export function DashboardClient({
  calorieGoal,
  proteinGoal,
  entries,
  displayName,
}: {
  calorieGoal: number;
  proteinGoal: number;
  entries: FoodEntry[];
  displayName: string | null;
}) {
  const [showForm, setShowForm] = useState(false);

  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + Number(e.protein_g),
      carbs: acc.carbs + Number(e.carbs_g),
      fat: acc.fat + Number(e.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const grouped = CATEGORIES.map((category) => ({
    category,
    items: entries.filter((e) => e.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {displayName ? `Hi, ${displayName}` : "Today"}
        </h1>
      </div>

      <MacroRings
        calories={totals.calories}
        calorieGoal={calorieGoal}
        proteinG={totals.protein}
        proteinGoal={proteinGoal}
        carbsG={totals.carbs}
        fatG={totals.fat}
      />

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Food log</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? "Close" : "Add food"}
          </button>
        </div>

        {showForm && <AddFoodForm onSuccess={() => setShowForm(false)} />}

        <div className="mt-4 flex flex-col gap-4">
          {grouped.length === 0 && (
            <p className="rounded-xl bg-zinc-100 px-4 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              Nothing logged yet today.
            </p>
          )}

          {grouped.map(({ category, items }) => (
            <div key={category}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {category}
              </h3>
              <ul className="flex flex-col divide-y divide-zinc-100 rounded-xl bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{item.food_name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {item.calories} kcal · {Math.round(Number(item.protein_g))}p /{" "}
                        {Math.round(Number(item.carbs_g))}c / {Math.round(Number(item.fat_g))}f
                      </p>
                    </div>
                    <button
                      onClick={() => deleteFoodEntry(item.id)}
                      aria-label={`Delete ${item.food_name}`}
                      className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddFoodForm({ onSuccess }: { onSuccess: () => void }) {
  const [state, formAction, pending] = useActionState(async (prev: FoodFormState, formData: FormData) => {
    const result = await addFoodEntry(prev, formData);
    if (!result.error) onSuccess();
    return result;
  }, initialState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-900">
      <input
        name="foodName"
        placeholder="Food name"
        required
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      />

      <select
        name="category"
        defaultValue="Breakfast"
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-4 gap-2">
        <input
          name="calories"
          type="number"
          min={0}
          placeholder="kcal"
          required
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <input
          name="proteinG"
          type="number"
          min={0}
          placeholder="protein g"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <input
          name="carbsG"
          type="number"
          min={0}
          placeholder="carbs g"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <input
          name="fatG"
          type="number"
          min={0}
          placeholder="fat g"
          className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add to log"}
      </button>
    </form>
  );
}
