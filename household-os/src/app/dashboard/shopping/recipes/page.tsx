import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { RecipeDialog } from "@/components/shopping/recipe-dialog";
import { AddRecipeToListButton } from "@/components/shopping/add-recipe-to-list-button";
import { DeleteIconButton } from "@/components/tasks/delete-icon-button";
import { deleteRecipeAction } from "@/actions/shopping";

export default async function RecipesPage() {
  const { household } = await requireMembership();
  const supabase = await createClient();

  const [{ data: recipes }, { data: list }] = await Promise.all([
    supabase
      .from("recipes")
      .select("*, recipe_ingredients(*)")
      .eq("household_id", household.id)
      .order("created_at", { ascending: false }),
    supabase.from("shopping_lists").select("id").eq("household_id", household.id).limit(1).maybeSingle(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recipe box</h1>
        <RecipeDialog>
          <Button size="sm">
            <Plus className="h-4 w-4" /> Recipe
          </Button>
        </RecipeDialog>
      </div>

      {!recipes || recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recipes yet. Save one, then drop its ingredients onto your shopping list in one tap.
        </p>
      ) : (
        recipes.map((recipe) => (
          <Card key={recipe.id} className="group">
            <CardHeader className="flex flex-row items-start justify-between">
              <CardTitle className="text-base">{recipe.title}</CardTitle>
              <DeleteIconButton onDelete={deleteRecipeAction.bind(null, recipe.id)} />
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {recipe.recipe_ingredients.map((ing) => (
                  <li key={ing.id}>
                    {ing.name}
                    {ing.quantity ? ` — ${ing.quantity}` : ""}
                  </li>
                ))}
              </ul>
              {recipe.notes && <p className="text-sm">{recipe.notes}</p>}
              <AddRecipeToListButton recipeId={recipe.id} listId={list?.id ?? null} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
