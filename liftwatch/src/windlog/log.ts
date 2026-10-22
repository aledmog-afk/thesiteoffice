/**
 * Lift-day wind log: anemometer readings taken during the lift, checked against the
 * permitted limit, with the stop / wait / restart pattern from CPA/TCIG 2507
 * section 6.4.3:
 *
 * - A reading above the limit means stop.
 * - "It is common practice to wait 30 minutes after the wind speed drops below the
 *   threshold before attempting to lift again." (BS 7121-5 sets 10 minutes for tower
 *   cranes, so the wait is a setting.)
 * - "If the wind exceeds the winding-off threshold, the timer 'resets'. After this
 *   happens three or four times, the day may need to be declared 'winded off'."
 * - "Keeping accurate records should remain essential."
 *
 * The crane's anemometer is at the boom / jib head, so its gust reading compares
 * directly with the permitted speed (no height factor). The crane operator always
 * makes the final decision (CPA 6.4). This log never says a lift may go ahead.
 */

export type SpeedUnit = 'ms' | 'mph' | 'kmh' | 'kn';

export const UNIT_LABEL: Readonly<Record<SpeedUnit, string>> = Object.freeze({ ms: 'm/s', mph: 'mph', kmh: 'km/h', kn: 'knots' });

/** Exact conversions: 1 mph = 0.44704 m/s, 1 km/h = 1/3.6 m/s, 1 knot = 1852/3600 m/s. */
const TO_MS: Readonly<Record<SpeedUnit, number>> = Object.freeze({ ms: 1, mph: 0.44704, kmh: 1 / 3.6, kn: 1852 / 3600 });

export function toMs(value: number, unit: SpeedUnit): number {
  return value * TO_MS[unit];
}

export function fromMs(ms: number, unit: SpeedUnit): number {
  return ms / TO_MS[unit];
}

/** "6.6 m/s · 15 mph · 24 km/h · 13 knots" */
export function allUnits(ms: number): string {
  return (['ms', 'mph', 'kmh', 'kn'] as SpeedUnit[])
    .map((u) => `${fromMs(ms, u).toFixed(u === 'ms' ? 1 : 0)} ${UNIT_LABEL[u]}`)
    .join(' · ');
}

export type LogKind = 'reading' | 'note' | 'wind-off';

export interface LogEntry {
  id: string;
  recordId: string;
  /** When it was logged (ISO). */
  at: string;
  kind: LogKind;
  /** Reading as entered, and in m/s. */
  value?: number;
  unit?: SpeedUnit;
  gustMs?: number;
  note?: string;
  by?: string;
}

export type LogState = 'no-readings' | 'within' | 'near' | 'stopped' | 'waiting' | 'waited' | 'wound-off';

export const STATE_LABEL: Readonly<Record<LogState, string>> = Object.freeze({
  'no-readings': 'No readings',
  within: 'Within limit',
  near: 'Near limit',
  stopped: 'Stop',
  waiting: 'Waiting',
  waited: 'Wait complete',
  'wound-off': 'Winded off',
});

export interface LogEvaluation {
  state: LogState;
  /** For 'waiting' / 'waited': when readings dropped back below the limit. */
  belowSince: string | null;
  minutesWaited: number;
  /** Times the wait was reset by a reading above the limit. */
  resets: number;
  lastReading: LogEntry | null;
  headline: string;
  detail: string;
  /** Per reading, the state straight after it, in time order. */
  timeline: { entry: LogEntry; state: LogState }[];
}

export const DEFAULT_WAIT_MINUTES = 30;
export const RESETS_BEFORE_WIND_OFF_PROMPT = 3;
const NEAR = 0.8;

const minutesBetween = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / 60000;

/** Works through the log in time order. `now` decides how long the wait has run. */
export function evaluateLog(entries: LogEntry[], limitMs: number, waitMinutes: number, now: Date): LogEvaluation {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  let state: LogState = 'no-readings';
  let belowSince: string | null = null;
  let resets = 0;
  let lastReading: LogEntry | null = null;
  const timeline: LogEvaluation['timeline'] = [];

  for (const e of sorted) {
    if (e.kind === 'wind-off') {
      state = 'wound-off';
      timeline.push({ entry: e, state });
      continue;
    }
    if (e.kind !== 'reading' || e.gustMs === undefined || state === 'wound-off') {
      timeline.push({ entry: e, state });
      continue;
    }
    lastReading = e;
    const over = e.gustMs > limitMs;
    if (over) {
      if (state === 'waiting' || state === 'waited') resets += 1;
      state = 'stopped';
      belowSince = null;
    } else if (state === 'stopped') {
      state = 'waiting';
      belowSince = e.at;
    } else if (state === 'waiting' || state === 'waited') {
      // Still below the limit: keep counting from when it first dropped.
    } else {
      state = e.gustMs >= NEAR * limitMs ? 'near' : 'within';
    }
    if ((state === 'waiting' || state === 'waited') && belowSince) {
      state = minutesBetween(belowSince, new Date(e.at)) >= waitMinutes ? 'waited' : 'waiting';
    }
    timeline.push({ entry: e, state });
  }

  let minutesWaited = 0;
  if ((state === 'waiting' || state === 'waited') && belowSince) {
    minutesWaited = Math.max(0, minutesBetween(belowSince, now));
    state = minutesWaited >= waitMinutes ? 'waited' : 'waiting';
  }

  const since = belowSince ? hhmm(belowSince) : '';
  const windOffHint =
    resets >= RESETS_BEFORE_WIND_OFF_PROMPT
      ? ` The wait has been reset ${resets} times: CPA 6.4.3 says the day may need to be declared winded off.`
      : '';
  const texts: Record<LogState, [string, string]> = {
    'no-readings': ['No readings yet', 'Log the crane anemometer gust reading before the first lift and regularly during lifting.'],
    within: ['Last reading within the permitted limit', 'Keep logging readings. The crane operator decides whether to lift, continue or stop.'],
    near: ['Last reading near the permitted limit', 'At or above 80 % of the limit. Watch the trend and be ready to stop.'],
    stopped: ['Stop: reading above the permitted limit', `Wait until readings stay below the limit for ${waitMinutes} minutes (CPA 6.4.3).${windOffHint}`],
    waiting: [
      `Waiting: below the limit since ${since}`,
      `${Math.floor(minutesWaited)} of ${waitMinutes} minutes. A reading above the limit resets the wait.${windOffHint}`,
    ],
    waited: [
      `Below the limit for ${waitMinutes} minutes (since ${since})`,
      `The crane operator decides whether to restart, with the lifting team (CPA 6.4).${windOffHint}`,
    ],
    'wound-off': ['Winded off for the day', 'Logged as winded off. Further readings are recorded but do not change this.'],
  };
  const [headline, detail] = texts[state];
  return { state, belowSince, minutesWaited, resets, lastReading, headline, detail, timeline };
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

let counter = 0;
export function newLogEntry(recordId: string, kind: LogKind, fields: Partial<LogEntry> = {}, now = new Date()): LogEntry {
  counter += 1;
  return { id: `${now.getTime().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, recordId, at: now.toISOString(), kind, ...fields };
}

export interface ForecastComparison {
  /** Readings that fall within a forecast hour of the lift day. */
  pairs: { entry: LogEntry; forecastMs: number; ratio: number }[];
  /** Mean of measured ÷ forecast gust at height. Null with no pairs. */
  meanRatio: number | null;
}

/**
 * Measured gusts against the forecast gust at height for the same hour. CPA/TCIG
 * 2507 section 5.2.2: contractors are trialling comparing forecasts with on-site
 * readings to correct future forecasts. Over a pilot this shows whether the
 * forecast tends to run high or low at a site. It is not used in any status.
 */
export function compareWithForecast(
  entries: LogEntry[],
  hours: { time: string; gustAtHeightMs: number | null }[],
): ForecastComparison {
  const localHour = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .format(new Date(iso))
      .replace(', ', 'T')
      .slice(0, 13);
  const byHour = new Map(hours.map((h) => [h.time.slice(0, 13), h.gustAtHeightMs]));
  const pairs: ForecastComparison['pairs'] = [];
  for (const e of entries) {
    if (e.kind !== 'reading' || e.gustMs === undefined) continue;
    const f = byHour.get(localHour(e.at));
    if (f !== undefined && f !== null && f > 0) pairs.push({ entry: e, forecastMs: f, ratio: e.gustMs / f });
  }
  const meanRatio = pairs.length ? pairs.reduce((s, p) => s + p.ratio, 0) / pairs.length : null;
  return { pairs, meanRatio };
}
