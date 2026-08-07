export type MealCategory = "Breakfast" | "Lunch" | "Dinner" | "Snack";

export type Database = {
  public: {
    Tables: {
      fitness_profiles: {
        Row: {
          id: string;
          display_name: string | null;
          daily_calorie_goal: number;
          daily_protein_goal: number;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          daily_calorie_goal?: number;
          daily_protein_goal?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          daily_calorie_goal?: number;
          daily_protein_goal?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      fitness_exercises: {
        Row: {
          id: string;
          name: string;
          target_muscle_group: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          target_muscle_group?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          target_muscle_group?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      fitness_workouts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          started_at: string;
          completed_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          started_at?: string;
          completed_at?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          started_at?: string;
          completed_at?: string | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_workouts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fitness_workout_sets: {
        Row: {
          id: string;
          workout_id: string;
          exercise_id: string;
          set_number: number;
          weight_kg: number | null;
          reps: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workout_id: string;
          exercise_id: string;
          set_number: number;
          weight_kg?: number | null;
          reps?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          workout_id?: string;
          exercise_id?: string;
          set_number?: number;
          weight_kg?: number | null;
          reps?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_workout_sets_workout_id_fkey";
            columns: ["workout_id"];
            isOneToOne: false;
            referencedRelation: "fitness_workouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fitness_workout_sets_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "fitness_exercises";
            referencedColumns: ["id"];
          },
        ];
      };
      fitness_food_entries: {
        Row: {
          id: string;
          user_id: string;
          food_name: string;
          category: MealCategory;
          calories: number;
          protein_g: number;
          carbs_g: number;
          fat_g: number;
          consumed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          food_name: string;
          category: MealCategory;
          calories: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          consumed_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          food_name?: string;
          category?: MealCategory;
          calories?: number;
          protein_g?: number;
          carbs_g?: number;
          fat_g?: number;
          consumed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_food_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      fitness_meal_category: MealCategory;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["fitness_profiles"]["Row"];
export type Exercise = Database["public"]["Tables"]["fitness_exercises"]["Row"];
export type Workout = Database["public"]["Tables"]["fitness_workouts"]["Row"];
export type WorkoutSet = Database["public"]["Tables"]["fitness_workout_sets"]["Row"];
export type FoodEntry = Database["public"]["Tables"]["fitness_food_entries"]["Row"];
