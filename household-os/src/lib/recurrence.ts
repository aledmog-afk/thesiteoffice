import { addDays } from "date-fns";
import type { RecurrenceRule } from "@/lib/database.types";

const WEEKDAYS = [
  ["sunday", "sun"],
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
];

function findWeekdays(text: string): number[] {
  const found: number[] = [];
  WEEKDAYS.forEach((aliases, index) => {
    if (aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(text))) {
      found.push(index);
    }
  });
  return found;
}

export interface ParsedRecurrence {
  rule: RecurrenceRule;
  recurrenceText: string;
  nextDueDate: Date;
}

/**
 * Lightweight natural-language recurrence parser, e.g.
 * "change the furnace filter every 90 days" -> interval/90.
 * Todoist-style, but a small hand-rolled subset rather than a full grammar.
 */
export function parseRecurrence(input: string, from: Date = new Date()): ParsedRecurrence | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const numberMatch = text.match(
    /every\s+(\d+|other)\s*(day|days|week|weeks|month|months)\b/
  );
  if (numberMatch) {
    const [, rawCount, unit] = numberMatch;
    const count = rawCount === "other" ? 2 : parseInt(rawCount, 10);
    const intervalDays =
      unit.startsWith("week") ? count * 7 : unit.startsWith("month") ? count * 30 : count;
    return {
      rule: { freq: "interval", intervalDays },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, intervalDays),
    };
  }

  const bareDaysMatch = text.match(/every\s+(\d+)\s*$/);
  if (bareDaysMatch) {
    const intervalDays = parseInt(bareDaysMatch[1], 10);
    return {
      rule: { freq: "interval", intervalDays },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, intervalDays),
    };
  }

  if (/\b(daily|every day|each day)\b/.test(text)) {
    return {
      rule: { freq: "daily" },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, 1),
    };
  }

  const weekdays = findWeekdays(text);
  if (weekdays.length > 0) {
    return {
      rule: { freq: "weekly", weekdays },
      recurrenceText: input.trim(),
      nextDueDate: nextWeeklyOccurrence(from, weekdays),
    };
  }

  if (/\bweekly\b/.test(text)) {
    const weekday = from.getDay();
    return {
      rule: { freq: "weekly", weekdays: [weekday] },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, 7),
    };
  }

  if (/\bmonthly\b/.test(text)) {
    return {
      rule: { freq: "interval", intervalDays: 30 },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, 30),
    };
  }

  if (/\bfortnightly\b|\bbiweekly\b/.test(text)) {
    return {
      rule: { freq: "interval", intervalDays: 14 },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, 14),
    };
  }

  if (/\byearly\b|\bannually\b/.test(text)) {
    return {
      rule: { freq: "interval", intervalDays: 365 },
      recurrenceText: input.trim(),
      nextDueDate: addDays(from, 365),
    };
  }

  return null;
}

function nextWeeklyOccurrence(from: Date, weekdays: number[]): Date {
  for (let i = 0; i < 8; i++) {
    const candidate = addDays(from, i);
    if (weekdays.includes(candidate.getDay())) return candidate;
  }
  return addDays(from, 7);
}

export function describeRecurrence(rule: RecurrenceRule): string {
  if (rule.freq === "daily") return "Every day";
  if (rule.freq === "weekly" && rule.weekdays?.length) {
    const names = rule.weekdays.map((d) => WEEKDAYS[d][0]);
    return `Every ${names.join(", ")}`;
  }
  if (rule.freq === "interval" && rule.intervalDays) {
    if (rule.intervalDays % 7 === 0) return `Every ${rule.intervalDays / 7} week(s)`;
    return `Every ${rule.intervalDays} day(s)`;
  }
  return "Recurring";
}

export function computeNextDueDate(rule: RecurrenceRule, from: Date): Date {
  if (rule.freq === "daily") return addDays(from, 1);
  if (rule.freq === "weekly" && rule.weekdays?.length) {
    return nextWeeklyOccurrence(addDays(from, 1), rule.weekdays);
  }
  if (rule.freq === "interval" && rule.intervalDays) {
    return addDays(from, rule.intervalDays);
  }
  return addDays(from, 7);
}
