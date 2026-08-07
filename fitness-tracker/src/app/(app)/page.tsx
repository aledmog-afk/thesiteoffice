import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "./dashboard-client";

function todayRangeUTC() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { start, end } = todayRangeUTC();

  const [{ data: profile }, { data: entries }] = await Promise.all([
    supabase.from("fitness_profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("fitness_food_entries")
      .select("*")
      .eq("user_id", user.id)
      .gte("consumed_at", start)
      .lt("consumed_at", end)
      .order("consumed_at", { ascending: true }),
  ]);

  return (
    <DashboardClient
      calorieGoal={profile?.daily_calorie_goal ?? 2500}
      proteinGoal={profile?.daily_protein_goal ?? 150}
      entries={entries ?? []}
      displayName={profile?.display_name ?? null}
    />
  );
}
