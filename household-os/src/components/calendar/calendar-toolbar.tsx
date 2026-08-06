"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Link as LinkIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shiftDate, toDateParam, type CalendarViewKind } from "@/lib/calendar-range";
import { EventDialog } from "./event-dialog";
import type { Member } from "@/lib/types";
import { toast } from "sonner";

export function CalendarToolbar({
  view,
  date,
  members,
  currentMemberId,
  feedToken,
}: {
  view: CalendarViewKind;
  date: Date;
  members: Member[];
  currentMemberId: string;
  feedToken?: string;
}) {
  const router = useRouter();

  function go(nextView: CalendarViewKind, nextDate: Date) {
    router.push(`/dashboard/calendar?view=${nextView}&date=${toDateParam(nextDate)}`);
  }

  function copyFeedUrl() {
    if (!feedToken) return;
    const url = `${window.location.origin}/api/ics/${feedToken}`;
    navigator.clipboard.writeText(url);
    toast.success("Calendar feed link copied — add it to Google/Apple Calendar as a subscription.");
  }

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => go(view, shiftDate(view, date, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => go(view, new Date())}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={() => go(view, shiftDate(view, date, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-1 font-medium">
          {date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Tabs value={view} onValueChange={(v) => go(v as CalendarViewKind, date)}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="day">Day</TabsTrigger>
          </TabsList>
        </Tabs>
        {feedToken && (
          <Button variant="outline" size="icon" onClick={copyFeedUrl} title="Copy calendar subscription link">
            <LinkIcon className="h-4 w-4" />
          </Button>
        )}
        <EventDialog members={members} currentMemberId={currentMemberId} defaultDate={date}>
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Add event
          </Button>
        </EventDialog>
      </div>
    </div>
  );
}
