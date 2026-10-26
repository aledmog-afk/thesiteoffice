import type { Forecast } from './openMeteo';

/**
 * The last forecast fetched for each site, kept on the device so the assessment
 * still opens with no signal on site. Shown with a clear "offline" warning and
 * its original fetch time; never refreshed silently.
 */
// v2: hours carry their instant (epochMs) since LW-M1.2.
const PREFIX = 'liftwatch.forecast.v2.';
export const OFFLINE_MAX_AGE_HOURS = 48;

export function saveForecast(key: string, forecast: Forecast): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(forecast));
  } catch {
    /* storage full or blocked: offline copy is a convenience only */
  }
}

export function loadCachedForecast(key: string, now = new Date()): Forecast | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const f = JSON.parse(raw) as Forecast;
    const ageHours = (now.getTime() - Date.parse(f.fetchedAt)) / 3_600_000;
    return Number.isFinite(ageHours) && ageHours <= OFFLINE_MAX_AGE_HOURS ? f : null;
  } catch {
    return null;
  }
}
