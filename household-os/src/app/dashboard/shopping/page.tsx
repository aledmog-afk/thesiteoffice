import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";

export default async function ShoppingPage() {
  const { household } = await requireMembership();
  const supabase = await createClient();

  const { data: list } = await supabase
    .from("shopping_lists")
    .select("*")
    .eq("household_id", household.id)
    .limit(1)
    .maybeSingle();

  const { data: items } = list
    ? await supabase.from("shopping_items").select("*").eq("list_id", list.id).order("created_at")
    : { data: [] };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shopping list</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/shopping/recipes">
            <BookOpen className="h-4 w-4" />
            Recipe box
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shared list</CardTitle>
        </CardHeader>
        <CardContent>
          {list ? (
            <ShoppingListClient listId={list.id} initialItems={items ?? []} />
          ) : (
            <p className="text-sm text-muted-foreground">Setting up your shopping list...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
