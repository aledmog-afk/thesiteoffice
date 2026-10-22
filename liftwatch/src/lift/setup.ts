import type { SiteLocation } from '../data/postcode';
import { DEFAULT_DRAG_COEFFICIENT, MAX_METHOD_HEIGHT_M, type Terrain } from '../wind';

export type LimitType = 'gust' | 'mean';

/** Everything the AP enters on the set-up screen. Numbers are null until entered. */
export interface LiftSetup {
  site: SiteLocation | null;
  /** Upwind terrain around the site. Records saved before LW-M1.1 have none: open country. */
  terrain: Terrain;
  /** "YYYY-MM-DD" */
  liftDate: string;
  craneDescription: string;
  chartLimitMs: number | null;
  /** Where the chart limit came from, e.g. "Lift plan LP-014 / LTM 1090 load chart". Required. */
  chartLimitSource: string;
  chartLimitType: LimitType | null;
  /** Boom / jib head height above ground, used for the gust correction (m). CPA pages 22–23. */
  heightM: number | null;
  loadDescription: string;
  loadLengthM: number | null;
  loadHeightM: number | null;
  loadMassKg: number | null;
  riggingMassKg: number | null;
  dragCoefficient: number | null;
  /** Planned lift window, "HH:MM". Empty means sunrise to sunset. */
  windowStart: string;
  windowEnd: string;
}

export function emptySetup(today: string): LiftSetup {
  return {
    site: null,
    terrain: 'open',
    liftDate: today,
    craneDescription: '',
    chartLimitMs: null,
    chartLimitSource: '',
    chartLimitType: null,
    heightM: null,
    loadDescription: '',
    loadLengthM: null,
    loadHeightM: null,
    loadMassKg: null,
    riggingMassKg: 0,
    dragCoefficient: DEFAULT_DRAG_COEFFICIENT,
    windowStart: '',
    windowEnd: '',
  };
}

export type SetupField = keyof LiftSetup;
export type SetupErrors = Partial<Record<SetupField, string>>;

const positive = (v: number | null) => v !== null && Number.isFinite(v) && v > 0;

/** Field-level checks for the set-up screen. An empty result means ready to assess. */
export function validateSetup(s: LiftSetup): SetupErrors {
  const e: SetupErrors = {};
  if (!s.site) e.site = 'Look up a postcode or enter latitude and longitude.';
  if (!['open', 'town', 'city'].includes(s.terrain)) e.terrain = 'Choose the terrain around the site.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.liftDate)) e.liftDate = 'Enter the lift date.';
  if (!s.craneDescription.trim()) e.craneDescription = 'Describe the crane, e.g. "Liebherr LTM 1090-4.2, 40 t counterweight".';
  if (!positive(s.chartLimitMs)) e.chartLimitMs = 'Enter the in-service wind limit from the load chart, in m/s.';
  if (!s.chartLimitSource.trim()) e.chartLimitSource = 'Say where the limit came from, e.g. "Lift plan LP-014 / LTM 1090 load chart".';
  if (!s.chartLimitType) e.chartLimitType = 'Say whether the chart limit is a gust or a mean.';
  else if (s.chartLimitType === 'mean') {
    e.chartLimitType =
      'This method compares gusts at height with a gust limit. Get the 3-second gust limit from the crane supplier or lift plan.';
  }
  if (!positive(s.heightM)) e.heightM = 'Enter the boom / jib head height, in metres.';
  else if (s.heightM! > MAX_METHOD_HEIGHT_M) e.heightM = `Outside method range: the factors stop at ${MAX_METHOD_HEIGHT_M} m.`;
  if (!positive(s.loadLengthM)) e.loadLengthM = 'Enter the length of the face presented to the wind.';
  if (!positive(s.loadHeightM)) e.loadHeightM = 'Enter the height of the face presented to the wind.';
  if (!positive(s.loadMassKg)) e.loadMassKg = 'Enter the load mass in kg.';
  if (s.riggingMassKg === null || !Number.isFinite(s.riggingMassKg) || s.riggingMassKg < 0) {
    e.riggingMassKg = 'Enter the mass of rigging, hook block and hoist rope in kg (0 if included in the load mass).';
  }
  if (!positive(s.dragCoefficient)) e.dragCoefficient = 'Enter a drag coefficient above zero (1.2 for flat panels).';
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (s.windowStart && !hhmm.test(s.windowStart)) e.windowStart = 'Use HH:MM.';
  if (s.windowEnd && !hhmm.test(s.windowEnd)) e.windowEnd = 'Use HH:MM.';
  if (s.windowStart && s.windowEnd && hhmm.test(s.windowStart) && hhmm.test(s.windowEnd) && s.windowEnd <= s.windowStart) {
    e.windowEnd = 'The end must be after the start.';
  }
  return e;
}
