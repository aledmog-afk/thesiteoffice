import { requireMembership } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { RoutineDialog } from "@/components/tasks/routine-dialog";
import { CompleteTaskButton } from "./complete-task-button";
import { ApproveTaskButton } from "@/components/tasks/approve-task-button";
import { DeleteIconButton } from "@/components/tasks/delete-icon-button";
import { deleteTaskAction, deleteRoutineAction } from "@/actions/tasks";
import { describeRecurrence } from "@/lib/recurrence";
import type { Task } from "@/lib/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function TasksPage() {
  const { member, household } = await requireMembership();
  const supabase = await createClient();
  const isChild = member.role === "child";

  const [tasksQuery, { data: routines }, { data: members }] = await Promise.all([
    isChild
      ? supabase
          .from("tasks")
          .select("*")
          .eq("household_id", household.id)
          .eq("assignee_member_id", member.id)
          .order("due_date", { ascending: true, nullsFirst: false })
      : supabase
          .from("tasks")
          .select("*")
          .eq("household_id", household.id)
          .neq("status", "done")
          .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("routines").select("*").eq("household_id", household.id).eq("active", true),
    supabase.from("household_members").select("*").eq("household_id", household.id),
  ]);

  const { data: tasks } = tasksQuery;
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const today = todayIso();

  const pendingApproval = (tasks ?? []).filter((t) => t.status === "pending_approval");
  const open = (tasks ?? []).filter((t): t is Task => t.status === "open");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/tasks/leaderboard">
            <Trophy className="h-4 w-4" />
            Leaderboard
          </Link>
        </Button>
      </div>

      {!isChild && pendingApproval.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting for your approval</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingApproval.map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{task.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Completed by {memberById.get(task.assignee_member_id ?? "")?.display_name ?? "someone"}
                  </div>
                </div>
                <ApproveTaskButton taskId={task.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{isChild ? "Your tasks" : "Open tasks"}</CardTitle>
          {!isChild && (
            <TaskDialog members={members ?? []}>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" /> Task
              </Button>
            </TaskDialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open. Nice work.</p>
          ) : (
            open.map((task) => {
              const overdue = task.due_date && task.due_date < today;
              return (
                <div key={task.id} className="group flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <CompleteTaskButton taskId={task.id} />
                  <div className="flex-1">
                    <div className="font-medium">{task.title}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {task.assignee_member_id && (
                        <span>{memberById.get(task.assignee_member_id)?.display_name}</span>
                      )}
                      {task.due_date && <span>Due {task.due_date}</span>}
                      {task.points > 0 && <span>{task.points} pts</span>}
                    </div>
                  </div>
                  {overdue && (
                    <Badge variant="destructive" className="text-[10px]">
                      Overdue
                    </Badge>
                  )}
                  {!isChild && <DeleteIconButton onDelete={deleteTaskAction.bind(null, task.id)} />}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {!isChild && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recurring routines</CardTitle>
            <RoutineDialog members={members ?? []}>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" /> Routine
              </Button>
            </RoutineDialog>
          </CardHeader>
          <CardContent className="space-y-2">
            {!routines || routines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recurring chores yet.</p>
            ) : (
              routines.map((routine) => (
                <div key={routine.id} className="group flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{routine.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {describeRecurrence(routine.recurrence_rule)} &middot; {routine.points} pts
                      {routine.rotation_member_ids.length > 0 &&
                        ` · rotates: ${routine.rotation_member_ids
                          .map((id) => memberById.get(id)?.display_name)
                          .filter(Boolean)
                          .join(", ")}`}
                    </div>
                  </div>
                  <DeleteIconButton onDelete={deleteRoutineAction.bind(null, routine.id)} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
