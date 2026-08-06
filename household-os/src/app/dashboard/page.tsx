import Link from "next/link";
import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { NotesFeed } from "./notes-feed";
import { CompleteTaskButton } from "@/app/dashboard/tasks/complete-task-button";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default async function TodayPage() {
  const { member, household } = await requireMembership();
  const supabase = await createClient();

  const todayStart = startOfToday().toISOString();
  const todayEnd = endOfToday().toISOString();
  const todayDate = todayStart.slice(0, 10);

  const [{ data: events }, tasksQuery, { data: notes }, { data: members }] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("*")
      .eq("household_id", household.id)
      .gte("starts_at", todayStart)
      .lte("starts_at", todayEnd)
      .order("starts_at"),
    member.role === "child"
      ? supabase
          .from("tasks")
          .select("*")
          .eq("household_id", household.id)
          .eq("assignee_member_id", member.id)
          .neq("status", "done")
          .order("due_date", { ascending: true, nullsFirst: false })
      : supabase
          .from("tasks")
          .select("*")
          .eq("household_id", household.id)
          .neq("status", "done")
          .lte("due_date", todayDate)
          .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("household_notes")
      .select("*")
      .eq("household_id", household.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("household_members").select("*").eq("household_id", household.id),
  ]);

  const { data: tasks } = tasksQuery;
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </h1>
        <p className="text-muted-foreground">Hi {member.display_name}, here&apos;s today.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s events</CardTitle>
        </CardHeader>
        <CardContent>
          {events && events.length > 0 ? (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {event.all_day
                      ? "All day"
                      : new Date(event.starts_at).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                  </span>
                  <span className="font-medium">{event.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing on the calendar today.{" "}
              <Link href="/dashboard/calendar" className="underline">
                Add an event
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {member.role === "child" ? "Your tasks" : "Due today & overdue"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tasks && tasks.length > 0 ? (
            <ul className="space-y-2">
              {tasks.map((task) => {
                const overdue = task.due_date && task.due_date < todayDate;
                return (
                  <li key={task.id} className="flex items-center gap-3 text-sm">
                    {task.status === "pending_approval" ? (
                      <Badge variant="secondary">Pending approval</Badge>
                    ) : (
                      <CompleteTaskButton taskId={task.id} />
                    )}
                    <span className="flex-1">{task.title}</span>
                    {task.assignee_member_id && member.role !== "child" && (
                      <span className="text-xs text-muted-foreground">
                        {memberById.get(task.assignee_member_id)?.display_name}
                      </span>
                    )}
                    {overdue && (
                      <Badge variant="destructive" className="text-[10px]">
                        Overdue
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing due.{" "}
              <Link href="/dashboard/tasks" className="underline">
                View all tasks
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Household notes</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesFeed notes={notes ?? []} memberById={memberById} currentUserId={member.user_id} />
        </CardContent>
      </Card>
    </div>
  );
}
