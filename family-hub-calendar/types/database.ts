// Hand-written to cover build-order steps 1-3. Once a Supabase project exists,
// replace this file wholesale with:
//   npx supabase gen types typescript --project-id <ref> > types/database.ts
//
// Two shape requirements worth knowing before editing by hand:
//   * postgrest-js's GenericSchema needs Tables + Views + Functions, and every
//     table needs a Relationships key. Omit any of them and the Database type
//     silently collapses to `never`, which surfaces as baffling errors on
//     unrelated lines.
//   * These are `type` aliases, not `interface`s, on purpose: TypeScript only
//     gives implicit index signatures to type aliases, and the Realtime payload
//     generic is constrained to `{ [key: string]: any }`.

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type ListKind = 'shopping' | 'todo';
export type EventSyncStatus =
  | 'local_only'
  | 'synced'
  | 'pending_push'
  | 'pending_delete'
  | 'conflict';
export type RedemptionStatus = 'pending' | 'fulfilled' | 'cancelled';
export type ChoreStatus = 'pending' | 'done' | 'skipped';
export type LedgerDirection = 'earn' | 'redeem' | 'adjust_up' | 'adjust_down';

export type Household = {
  id: string;
  owner_user_id: string;
  name: string;
  timezone: string;
  created_at: string;
};

export type HouseholdSettings = {
  household_id: string;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
  weather_units: 'metric' | 'imperial';
  week_starts_on: number;
  enabled_meal_slots: MealSlot[];
  idle_timeout_seconds: number;
  slideshow_interval_seconds: number;
  dim_starts_at: string | null;
  dim_ends_at: string | null;
  dim_max_opacity: number;
  updated_at: string;
};

export type FamilyMember = {
  id: string;
  household_id: string;
  display_name: string;
  color: string;
  avatar_url: string | null;
  avatar_emoji: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type FamilyMemberInsert = {
  household_id: string;
  display_name: string;
  color: string;
  avatar_url?: string | null;
  avatar_emoji?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export type CalendarEvent = {
  id: string;
  household_id: string;
  calendar_id: string | null;
  member_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  event_timezone: string | null;
  rrule: string | null;
  recurrence_parent_id: string | null;
  recurrence_original_start: string | null;
  is_cancelled: boolean;
  provider_event_id: string | null;
  provider_etag: string | null;
  remote_updated_at: string | null;
  local_updated_at: string;
  sync_status: EventSyncStatus;
  created_at: string;
};

export type CalendarEventInsert = {
  id?: string;
  household_id: string;
  calendar_id?: string | null;
  member_id?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  starts_at: string;
  ends_at: string;
  all_day?: boolean;
  event_timezone?: string | null;
  rrule?: string | null;
  recurrence_parent_id?: string | null;
  recurrence_original_start?: string | null;
  is_cancelled?: boolean;
  sync_status?: EventSyncStatus;
  local_updated_at?: string;
};

export type Chore = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  member_id: string | null;
  points_value: number;
  rrule: string | null;
  starts_on: string; // date
  ends_on: string | null;
  is_active: boolean;
  created_at: string;
};

export type ChoreInsert = {
  id?: string;
  household_id: string;
  title: string;
  notes?: string | null;
  member_id?: string | null;
  points_value?: number;
  rrule?: string | null;
  starts_on?: string;
  ends_on?: string | null;
  is_active?: boolean;
};

export type ChoreInstance = {
  id: string;
  household_id: string;
  chore_id: string;
  member_id: string | null;
  due_on: string; // date
  points_value: number;
  status: ChoreStatus;
  completed_at: string | null;
  completed_by_member_id: string | null;
};

export type ChoreInstanceInsert = {
  id?: string;
  household_id: string;
  chore_id: string;
  member_id?: string | null;
  due_on: string;
  points_value: number;
  status?: ChoreStatus;
};

export type PointsLedgerEntry = {
  id: number;
  household_id: string;
  member_id: string;
  direction: LedgerDirection;
  amount: number;
  signed_amount: number;
  source_chore_instance_id: string | null;
  source_redemption_id: string | null;
  note: string | null;
  occurred_at: string;
};

export type MemberPointsCache = {
  member_id: string;
  household_id: string;
  balance: number;
  lifetime_earned: number;
  updated_at: string;
};

export type Reward = {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  point_cost: number;
  is_active: boolean;
  created_at: string;
};

export type RewardInsert = {
  id?: string;
  household_id: string;
  name: string;
  description?: string | null;
  emoji?: string | null;
  point_cost: number;
  is_active?: boolean;
};

export type RewardRedemption = {
  id: string;
  household_id: string;
  reward_id: string;
  member_id: string;
  point_cost_at_redemption: number;
  status: RedemptionStatus;
  redeemed_at: string;
  fulfilled_at: string | null;
};

export type LeaderboardRow = {
  member_id: string;
  display_name: string;
  color: string;
  earned: number;
  balance: number;
  rank_position: number;
};

export type List = {
  id: string;
  household_id: string;
  name: string;
  kind: ListKind;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
};

export type ListItem = {
  id: string;
  household_id: string;
  list_id: string;
  title: string;
  quantity_text: string | null;
  aisle: string | null;
  is_done: boolean;
  done_at: string | null;
  done_by_member_id: string | null;
  assigned_member_id: string | null;
  source_meal_plan_entry_id: string | null;
  position: number;
  created_at: string;
};

export type ListItemInsert = {
  // Supplied by the client, not defaulted by the database: an optimistic row
  // and its Realtime echo must share an id or the item appears twice.
  id?: string;
  household_id: string;
  list_id: string;
  title: string;
  quantity_text?: string | null;
  aisle?: string | null;
  is_done?: boolean;
  done_at?: string | null;
  done_by_member_id?: string | null;
  assigned_member_id?: string | null;
  source_meal_plan_entry_id?: string | null;
  position?: number;
};

export type Database = {
  public: {
    Tables: {
      households: {
        Row: Household;
        Insert: {
          id?: string;
          owner_user_id: string;
          name: string;
          timezone?: string;
          created_at?: string;
        };
        Update: Partial<Household>;
        Relationships: [];
      };
      household_settings: {
        Row: HouseholdSettings;
        Insert: { household_id: string } & Partial<Omit<HouseholdSettings, 'household_id'>>;
        Update: Partial<HouseholdSettings>;
        Relationships: [];
      };
      family_members: {
        Row: FamilyMember;
        Insert: FamilyMemberInsert;
        Update: Partial<FamilyMemberInsert>;
        Relationships: [];
      };
      events: {
        Row: CalendarEvent;
        Insert: CalendarEventInsert;
        Update: Partial<Omit<CalendarEventInsert, 'id' | 'household_id'>>;
        Relationships: [];
      };
      chores: {
        Row: Chore;
        Insert: ChoreInsert;
        Update: Partial<Omit<ChoreInsert, 'id' | 'household_id'>>;
        Relationships: [];
      };
      chore_instances: {
        Row: ChoreInstance;
        Insert: ChoreInstanceInsert;
        // No UPDATE policy exists for the client (§2.3): status moves only
        // through complete_/uncomplete_chore_instance so a tick always writes
        // a matching ledger row.
        Update: never;
        Relationships: [];
      };
      points_ledger: {
        Row: PointsLedgerEntry;
        Insert: never; // append-only, RPC-written
        Update: never;
        Relationships: [];
      };
      member_points_cache: {
        Row: MemberPointsCache;
        Insert: never; // trigger-maintained projection
        Update: never;
        Relationships: [];
      };
      rewards: {
        Row: Reward;
        Insert: RewardInsert;
        Update: Partial<Omit<RewardInsert, 'id' | 'household_id'>>;
        Relationships: [];
      };
      reward_redemptions: {
        Row: RewardRedemption;
        // SELECT-only for the client: the balance check lives inside
        // redeem_reward(), so a direct insert here would take a reward
        // without paying for it (§2.3).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lists: {
        Row: List;
        Insert: {
          id?: string;
          household_id: string;
          name: string;
          kind: ListKind;
          is_archived?: boolean;
          sort_order?: number;
        };
        Update: Partial<Omit<List, 'id' | 'household_id' | 'created_at'>>;
        Relationships: [];
      };
      list_items: {
        Row: ListItem;
        Insert: ListItemInsert;
        Update: Partial<Omit<ListItemInsert, 'id' | 'household_id' | 'list_id'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // Present in 0001_init.sql; typed here so callers in steps 6-7 get
      // checked arguments rather than `any`.
      complete_chore_instance: {
        Args: { p_instance_id: string; p_by_member_id?: string | null };
        Returns: unknown;
      };
      uncomplete_chore_instance: {
        Args: { p_instance_id: string };
        Returns: unknown;
      };
      redeem_reward: {
        Args: { p_member_id: string; p_reward_id: string };
        Returns: unknown;
      };
      adjust_points: {
        Args: {
          p_member_id: string;
          p_amount: number;
          p_direction: 'adjust_up' | 'adjust_down';
          p_note?: string | null;
        };
        Returns: unknown;
      };
      fulfil_redemption: {
        Args: { p_redemption_id: string };
        Returns: unknown;
      };
      cancel_redemption: {
        Args: { p_redemption_id: string };
        Returns: unknown;
      };
      leaderboard: {
        Args: { p_from: string; p_to: string };
        Returns: LeaderboardRow[];
      };
    };
  };
};
