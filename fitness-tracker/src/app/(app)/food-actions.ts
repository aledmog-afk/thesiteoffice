"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MealCategory } from "@/lib/supabase/database.types";

export type FoodFormState = { error: string | null };

export async function addFoodEntry(
  _prevState: FoodFormState,
  formData: FormData
): Promise<FoodFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be logged in." };
  }

  const foodName = String(formData.get("foodName") ?? "").trim();
  const category = String(formData.get("category") ?? "") as MealCategory;
  const calories = Number(formData.get("calories"));
  const proteinG = Number(formData.get("proteinG") ?? 0);
  const carbsG = Number(formData.get("carbsG") ?? 0);
  const fatG = Number(formData.get("fatG") ?? 0);

  if (!foodName || !Number.isFinite(calories) || calories < 0) {
    return { error: "Enter a food name and a valid calorie amount." };
  }

  const { error } = await supabase.from("fitness_food_entries").insert({
    user_id: user.id,
    food_name: foodName,
    category,
    calories: Math.round(calories),
    protein_g: proteinG || 0,
    carbs_g: carbsG || 0,
    fat_g: fatG || 0,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { error: null };
}

export async function deleteFoodEntry(id: string) {
  const supabase = await createClient();
  await supabase.from("fitness_food_entries").delete().eq("id", id);
  revalidatePath("/");
}
