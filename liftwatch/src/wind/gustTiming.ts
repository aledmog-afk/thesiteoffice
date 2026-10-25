import { HOUR_MS } from '../time/london';
import { hourStarts } from './instants';
import type { ForecastHour } from './types';

/** The two Open-Meteo gust values that bound one hour, and the one assessed. */
export interface HourGust {
  /** Gust stamped at the hour's start H: the maximum over (H-1h, H]. */
  stampedMs: number | null;
  /** Gust stamped at H+1h: the maximum over (H, H+1h]. Null when that value is missing or beyond the forecast. */
  nextMs: number | null;
  /** Gust assessed for H to H+1h: the higher of the two. Null unless both are known. */
  assessedMs: number | null;
}

/**
 * Gust timing rule (METHOD.md, "Which hour a gust belongs to", LW-M1.3).
 *
 * Open-Meteo's wind_gusts_10m stamped T is "a maximum of the preceding hour", so it
 * covers (T-1h, T]. The hour H to H+1h is therefore covered by the value stamped
 * H+1h. LiftWatch assesses each hour against the HIGHER of the values stamped H and
 * H+1h, so a rising wind is never shown an hour late and a falling wind is not
 * shown an hour early. Both values must be known; otherwise the hour has no data.
 *
 * The next stamp is found by instant (start + 1 h), so the repeated October hour and
 * the skipped March hour pair up correctly.
 */
export function hourGusts(hours: ForecastHour[], starts: number[] = hourStarts(hours)): HourGust[] {
  const byStart = new Map(starts.map((ms, i) => [ms, i]));
  return hours.map((h, i) => {
    const j = byStart.get(starts[i] + HOUR_MS);
    const stampedMs = h.windGusts10mMs;
    const nextMs = j === undefined ? null : hours[j].windGusts10mMs;
    const assessedMs = stampedMs === null || nextMs === null ? null : Math.max(stampedMs, nextMs);
    return { stampedMs, nextMs, assessedMs };
  });
}
