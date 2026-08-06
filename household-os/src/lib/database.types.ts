// Hand-written to match supabase/migrations/0001_init.sql.
// Regenerate with `mcp__Supabase__generate_typescript_types` once a project is linked.

export type Role = "owner" | "adult" | "child";
export type Plan = "free" | "paid";
export type TaskStatus = "open" | "pending_approval" | "done";
export type InviteStatus = "pending" | "accepted" | "revoked";

export interface RecurrenceRule {
  freq: "daily" | "weekly" | "interval";
  intervalDays?: number;
  weekdays?: number[]; // 0 = Sunday
}

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Row<T, R extends Relationship[] = []> = {
  Row: T;
  Insert: Partial<T> & Record<string, unknown>;
  Update: Partial<T>;
  Relationships: R;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

type HouseholdRow = {
  id: string;
  name: string;
  plan: Plan;
  created_by: string;
  created_at: string;
}

type MemberRow = {
  id: string;
  household_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  color: string;
  points: number;
  created_at: string;
}

type InviteRow = {
  id: string;
  household_id: string;
  email: string;
  role: "adult" | "child";
  token: string;
  invited_by: string;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
}

type PropertyRow = {
  id: string;
  household_id: string;
  name: string;
  address: string | null;
  created_at: string;
}

type CalendarEventRow = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  color: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

type CalendarEventAssigneeRow = {
  event_id: string;
  member_id: string;
}

type CalendarFeedTokenRow = {
  household_id: string;
  token: string;
}

type RoutineRow = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  recurrence_rule: RecurrenceRule;
  recurrence_text: string;
  rotation_member_ids: string[];
  rotation_index: number;
  points: number;
  active: boolean;
  next_due_date: string;
  created_by: string;
  created_at: string;
}

type TaskRow = {
  id: string;
  household_id: string;
  routine_id: string | null;
  title: string;
  notes: string | null;
  assignee_member_id: string | null;
  due_date: string | null;
  status: TaskStatus;
  points: number;
  created_by: string;
  completed_at: string | null;
  completed_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

type ShoppingListRow = {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
}

type RecipeRow = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
  created_by: string;
  created_at: string;
}

type RecipeIngredientRow = {
  id: string;
  recipe_id: string;
  name: string;
  quantity: string | null;
  aisle: string | null;
  position: number;
}

type ShoppingItemRow = {
  id: string;
  list_id: string;
  household_id: string;
  name: string;
  quantity: string | null;
  aisle: string;
  checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  recipe_id: string | null;
  position: number;
  created_at: string;
}

type HouseholdNoteRow = {
  id: string;
  household_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

type InviteLookupRow = {
  id: string;
  household_id: string;
  household_name: string;
  email: string;
  role: "adult" | "child";
  status: InviteStatus;
  expires_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: Row<ProfileRow>;
      households: Row<HouseholdRow>;
      household_members: Row<MemberRow>;
      invites: Row<InviteRow>;
      properties: Row<PropertyRow>;
      calendar_events: Row<CalendarEventRow>;
      calendar_event_assignees: Row<
        CalendarEventAssigneeRow,
        [
          {
            foreignKeyName: "calendar_event_assignees_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "calendar_events";
            referencedColumns: ["id"];
          },
        ]
      >;
      calendar_feed_tokens: Row<CalendarFeedTokenRow>;
      routines: Row<RoutineRow>;
      tasks: Row<TaskRow>;
      shopping_lists: Row<ShoppingListRow>;
      recipes: Row<RecipeRow>;
      recipe_ingredients: Row<
        RecipeIngredientRow,
        [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ]
      >;
      shopping_items: Row<ShoppingItemRow>;
      household_notes: Row<HouseholdNoteRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_household: {
        Args: { p_name: string; p_display_name: string };
        Returns: HouseholdRow;
      };
      get_invite_by_token: {
        Args: { p_token: string };
        Returns: InviteLookupRow[];
      };
      accept_invite: {
        Args: { p_token: string };
        Returns: MemberRow;
      };
    };
  };
}
