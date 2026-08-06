"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Loader2 } from "lucide-react";
import { addRecipeToListAction } from "@/actions/shopping";

export function AddRecipeToListButton({ recipeId, listId }: { recipeId: string; listId: string | null }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || !listId}
      onClick={() =>
        startTransition(async () => {
          if (!listId) return;
          await addRecipeToListAction(recipeId, listId);
          toast.success("Ingredients added to your shopping list.");
        })
      }
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
      Add to list
    </Button>
  );
}
