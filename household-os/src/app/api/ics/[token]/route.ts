import { NextResponse } from "next/server";
import { createEvents, type EventAttributes } from "ics";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: feedToken } = await supabase
    .from("calendar_feed_tokens")
    .select("household_id")
    .eq("token", token)
    .maybeSingle();

  if (!feedToken) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data: events } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("household_id", feedToken.household_id)
    .order("starts_at");

  const icsEvents: EventAttributes[] = (events ?? []).map((event) => {
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);
    return {
      uid: `${event.id}@household-os`,
      title: event.title,
      description: event.notes ?? undefined,
      location: event.location ?? undefined,
      start: [start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes()],
      end: [end.getFullYear(), end.getMonth() + 1, end.getDate(), end.getHours(), end.getMinutes()],
    };
  });

  const { error, value } = createEvents(icsEvents);
  if (error) {
    return new NextResponse("Failed to build calendar feed", { status: 500 });
  }

  return new NextResponse(value, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=household.ics",
      "Cache-Control": "public, max-age=300",
    },
  });
}
