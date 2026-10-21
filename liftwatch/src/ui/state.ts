import { roundCoord, type Forecast } from '../data/openMeteo';
import { AssessmentError, assessLift, type LiftAssessment } from '../lift/assessment';
import { emptySetup, validateSetup, type LiftSetup } from '../lift/setup';
import type { RecordStore } from '../storage/types';
import { OutsideMethodRangeError, WindInputError } from '../wind';
import { safeStorage } from './dom';
import { ukToday } from './format';

export type Screen = 'setup' | 'assessment' | 'decision' | 'records';

export interface AppState {
  screen: Screen;
  setup: LiftSetup;
  forecast: Forecast | null;
  /** Rounded site the forecast is for, so a changed site triggers a new fetch. */
  forecastKey: string | null;
  forecastError: string | null;
  loading: boolean;
  assessment: LiftAssessment | null;
  assessmentError: string | null;
  /** Hour picked on the chart, "YYYY-MM-DDTHH:MM". */
  selectedHour: string | null;
  /** Record open on the records screen. */
  viewingRecordId: string | null;
  store: RecordStore;
  storePersistent: boolean;
}

const SETUP_KEY = 'liftwatch.setup.v1';

function loadSetup(): LiftSetup {
  const today = ukToday();
  const fresh = emptySetup(today);
  const raw = safeStorage.get(SETUP_KEY);
  if (!raw) return fresh;
  try {
    const saved = { ...fresh, ...(JSON.parse(raw) as Partial<LiftSetup>) };
    // A lift date in the past is never useful: start from today.
    if (saved.liftDate < today) saved.liftDate = today;
    return saved;
  } catch {
    return fresh;
  }
}

export function saveSetup(setup: LiftSetup): void {
  safeStorage.set(SETUP_KEY, JSON.stringify(setup));
}

export function createState(store: RecordStore, persistent: boolean): AppState {
  return {
    screen: 'setup',
    setup: loadSetup(),
    forecast: null,
    forecastKey: null,
    forecastError: null,
    loading: false,
    assessment: null,
    assessmentError: null,
    selectedHour: null,
    viewingRecordId: null,
    store,
    storePersistent: persistent,
  };
}

export function setupReady(setup: LiftSetup): boolean {
  return Object.keys(validateSetup(setup)).length === 0;
}

export function siteKey(setup: LiftSetup): string | null {
  return setup.site ? `${roundCoord(setup.site.latitude).toFixed(2)},${roundCoord(setup.site.longitude).toFixed(2)}` : null;
}

/** Re-runs the method on the current set-up and forecast. */
export function recompute(state: AppState): void {
  state.assessment = null;
  state.assessmentError = null;
  if (!state.forecast || !setupReady(state.setup)) return;
  try {
    state.assessment = assessLift(state.setup, state.forecast);
  } catch (err) {
    if (err instanceof AssessmentError || err instanceof WindInputError || err instanceof OutsideMethodRangeError) {
      state.assessmentError = err.message;
    } else {
      throw err;
    }
  }
}
