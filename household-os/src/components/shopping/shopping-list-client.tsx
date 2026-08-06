"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import {
  addShoppingItemAction,
  toggleShoppingItemAction,
  deleteShoppingItemAction,
  clearCheckedItemsAction,
} from "@/actions/shopping";
import { AISLE_ORDER } from "@/lib/aisles";
import { X } from "lucide-react";
import type { ShoppingItem } from "@/lib/types";

export function ShoppingListClient({
  listId,
  initialItems,
}: {
  listId: string;
  initialItems: ShoppingItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const addWithList = addShoppingItemAction.bind(null, listId);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`shopping_items:${listId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shopping_items", filter: `list_id=eq.${listId}` },
        (payload) => {
          setItems((current) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as ShoppingItem;
              if (current.some((i) => i.id === row.id)) return current;
              return [...current, row];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as ShoppingItem;
              return current.map((i) => (i.id === row.id ? row : i));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as ShoppingItem;
              return current.filter((i) => i.id !== row.id);
            }
            return current;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId]);

  const byAisle = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const list = byAisle.get(item.aisle) ?? [];
    list.push(item);
    byAisle.set(item.aisle, list);
  }
  const aisles = AISLE_ORDER.filter((a) => byAisle.has(a));
  const hasChecked = items.some((i) => i.checked);

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        action={async (formData) => {
          await addWithList(undefined, formData);
          formRef.current?.reset();
        }}
        className="flex gap-2"
      >
        <Input name="name" placeholder="Milk, eggs, bread..." className="flex-1" required />
        <SubmitButton size="sm">Add</SubmitButton>
      </form>

      {aisles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your list is empty. Add something above.</p>
      ) : (
        aisles.map((aisle) => (
          <div key={aisle}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{aisle}</h3>
            <ul className="space-y-1">
              {byAisle
                .get(aisle)!
                .sort((a, b) => Number(a.checked) - Number(b.checked))
                .map((item) => (
                  <li key={item.id} className="group flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={(checked) =>
                        startTransition(() => toggleShoppingItemAction(item.id, checked === true))
                      }
                    />
                    <span className={item.checked ? "flex-1 text-muted-foreground line-through" : "flex-1"}>
                      {item.name}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => startTransition(() => deleteShoppingItemAction(item.id))}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}

      {hasChecked && (
        <Button variant="outline" size="sm" onClick={() => startTransition(() => clearCheckedItemsAction(listId))}>
          Clear checked items
        </Button>
      )}
    </div>
  );
}
