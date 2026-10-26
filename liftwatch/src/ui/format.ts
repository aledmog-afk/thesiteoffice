import { percentLabel } from '../lift/display';
import { londonClock } from '../time/london';
import { compassPoint, msToMph, STATUS_LABEL, type Status } from '../wind';

export function ms(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${v.toFixed(dp)} m/s`;
}

export function mph(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${msToMph(v).toFixed(0)} mph`;
}

/** "6.6 m/s (15 mph)" — m/s primary, mph secondary. */
export function speed(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${ms(v, dp)} (${mph(v)})`;
}

/** "% of limit". Give the status so the number never contradicts it near a threshold. */
export function pct(v: number | null | undefined, status?: Status): string {
  if (v === null || v === undefined) return '–';
  return status ? percentLabel(v, status) : `${Math.round(v)} %`;
}

export function num(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toFixed(dp);
}

export function direction(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return '–';
  return `from ${compassPoint(deg)} (${Math.round(deg)}°)`;
}

/** "YYYY-MM-DDTHH:MM" local → "HH:MM" */
export function hhmm(localTime: string): string {
  return localTime.slice(11, 16);
}

/**
 * Clock label for a forecast hour. Uses the hour's instant when it has one, so the
 * repeated October hour reads "01:00 BST" then "01:00 GMT".
 */
export function hourLabel(hr: { time: string; startMs?: number; epochMs?: number }): string {
  const ms = hr.startMs ?? hr.epochMs;
  return typeof ms === 'number' ? londonClock(ms) : hhmm(hr.time);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "2026-10-22" → "Thu 22 Oct 2026" */
export function longDate(date: string): string {
  return dateFmt.format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

export function shortDate(date: string): string {
  return dayFmt.format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

const instantFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** ISO instant → "21 Oct 2026, 20:00 BST" (UK time). */
export function instant(iso: string): string {
  return instantFmt.format(new Date(iso));
}

export function statusLabel(s: Status | null): string {
  return s ? STATUS_LABEL[s] : 'No daylight data';
}

/**
 * Icon that goes with every status colour, so colour never carries meaning alone.
 * Below the permitted speed has a plain circle, not a tick: it is not an approval.
 */
export const STATUS_ICON: Record<Status, string> = { within: '○', near: '!', over: '✕', 'no-data': '?' };

/** Today's date in the UK, "YYYY-MM-DD". */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
