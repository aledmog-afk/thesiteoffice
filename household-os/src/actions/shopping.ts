"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/session";
import { categorizeAisle } from "@/lib/aisles";

export type FormState = { error?: string } | undefined;

export async function addShoppingItemAction(listId: string, _prevState: FormState, formData: FormData): Promise<FormState> {
  const raw = String(formData.get("name") ?? "").trim();
  if (!raw) return { error: "Enter an item." };

  const { household } = await requireMembership();
  const supabase = await createClient();

  // Supports comma or newline separated free-text entry, e.g. "milk, eggs, bread".
  const names = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const { error } = await supabase.from("shopping_items").insert(
    names.map((name) => ({
      list_id: listId,
      household_id: household.id,
      name,
      aisle: categorizeAisle(name),
    }))
  );

  if (error) return { error: error.message };
  revalidatePath("/dashboard/shopping");
}

export async function toggleShoppingItemAction(itemId: string, checked: boolean) {
  const { member } = await requireMembership();
  const supabase = await createClient();
  await supabase
    .from("shopping_items")
    .update({
      checked,
      checked_by: checked ? member.user_id : null,
      checked_at: checked ? new Date().toISOString() : null,
    })
    .eq("id", itemId);
  revalidatePath("/dashboard/shopping");
}

export async function deleteShoppingItemAction(itemId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("shopping_items").delete().eq("id", itemId);
  revalidatePath("/dashboard/shopping");
}

export async function clearCheckedItemsAction(listId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("shopping_items").delete().eq("list_id", listId).eq("checked", true);
  revalidatePath("/dashboard/shopping");
}

export async function createRecipeAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const ingredientsRaw = String(formData.get("ingredients") ?? "").trim();

  if (!title) return { error: "Give the recipe a title." };
  const ingredients = ingredientsRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ingredients.length === 0) return { error: "Add at least one ingredient (one per line)." };

  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const { data: recipe, error } = await supabase
    .from("recipes")
    .insert({
      household_id: household.id,
      title,
      notes: notes || null,
      source_url: sourceUrl || null,
      created_by: member.user_id,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  await supabase.from("recipe_ingredients").insert(
    ingredients.map((name, index) => ({
      recipe_id: recipe.id,
      name,
      aisle: categorizeAisle(name),
      position: index,
    }))
  );

  revalidatePath("/dashboard/shopping/recipes");
}

export async function deleteRecipeAction(recipeId: string) {
  await requireMembership();
  const supabase = await createClient();
  await supabase.from("recipes").delete().eq("id", recipeId);
  revalidatePath("/dashboard/shopping/recipes");
}

export async function addRecipeToListAction(recipeId: string, listId: string) {
  const { household } = await requireMembership();
  const supabase = await createClient();

  const { data: ingredients } = await supabase
    .from("recipe_ingredients")
    .select("*")
    .eq("recipe_id", recipeId);

  if (!ingredients?.length) return;

  await supabase.from("shopping_items").insert(
    ingredients.map((ing) => ({
      list_id: listId,
      household_id: household.id,
      name: ing.quantity ? `${ing.name} (${ing.quantity})` : ing.name,
      aisle: ing.aisle ?? categorizeAisle(ing.name),
      recipe_id: recipeId,
    }))
  );

  revalidatePath("/dashboard/shopping");
}
