import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Trophy } from "lucide-react";

export default async function LeaderboardPage() {
  const { household } = await requireMembership();
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("household_members")
    .select("*")
    .eq("household_id", household.id)
    .order("points", { ascending: false });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Trophy className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Points from completed tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m, index) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <span className="w-5 text-center text-sm font-semibold text-muted-foreground">{index + 1}</span>
              <Avatar style={{ backgroundColor: m.color }} className="h-8 w-8">
                <AvatarFallback className="bg-transparent text-xs text-white">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 font-medium">{m.display_name}</span>
              <span className="text-sm text-muted-foreground">{m.points} pts</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
