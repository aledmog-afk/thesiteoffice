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
      leaderboard: {
        Args: { p_from: string; p_to: string };
        Returns: {
          member_id: string;
          display_name: string;
          color: string;
          earned: number;
          balance: number;
          rank_position: number;
        }[];
      };
    };
  };
};
