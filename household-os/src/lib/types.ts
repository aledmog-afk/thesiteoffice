import type { Database } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];

export type Profile = Tables["profiles"]["Row"];
export type Household = Tables["households"]["Row"];
export type Member = Tables["household_members"]["Row"];
export type Invite = Tables["invites"]["Row"];
export type Property = Tables["properties"]["Row"];
export type CalendarEvent = Tables["calendar_events"]["Row"];
export type Routine = Tables["routines"]["Row"];
export type Task = Tables["tasks"]["Row"];
export type ShoppingList = Tables["shopping_lists"]["Row"];
export type ShoppingItem = Tables["shopping_items"]["Row"];
export type Recipe = Tables["recipes"]["Row"];
export type RecipeIngredient = Tables["recipe_ingredients"]["Row"];
export type HouseholdNote = Tables["household_notes"]["Row"];

export type {
  Role,
  Plan,
  TaskStatus,
  InviteStatus,
  RecurrenceRule,
} from "@/lib/database.types";
