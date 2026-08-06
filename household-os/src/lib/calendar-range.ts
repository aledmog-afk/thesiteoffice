import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  format,
} from "date-fns";

export type CalendarViewKind = "month" | "week" | "day";

export function getVisibleRange(view: CalendarViewKind, date: Date) {
  if (view === "month") {
    return {
      gridStart: startOfWeek(startOfMonth(date)),
      gridEnd: endOfWeek(endOfMonth(date)),
    };
  }
  if (view === "week") {
    return { gridStart: startOfWeek(date), gridEnd: endOfWeek(date) };
  }
  return { gridStart: startOfDay(date), gridEnd: endOfDay(date) };
}

export function shiftDate(view: CalendarViewKind, date: Date, direction: 1 | -1) {
  if (view === "month") return direction === 1 ? addMonths(date, 1) : subMonths(date, 1);
  if (view === "week") return direction === 1 ? addWeeks(date, 1) : subWeeks(date, 1);
  return direction === 1 ? addDays(date, 1) : subDays(date, 1);
}

export function toDateParam(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function parseDateParam(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00`);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}
