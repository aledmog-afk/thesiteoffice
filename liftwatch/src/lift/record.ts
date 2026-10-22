import { APP_NAME, METHOD_VERSION } from '../config';
import type { Forecast } from '../data/openMeteo';
import type { LiftAssessment } from './assessment';
import type { LiftSetup } from './setup';

export type DecisionChoice = 'proceed' | 'postpone' | 'proceed-with-conditions';

export const DECISION_LABEL: Readonly<Record<DecisionChoice, string>> = Object.freeze({
  proceed: 'Proceed',
  postpone: 'Postpone',
  'proceed-with-conditions': 'Proceed with conditions',
});

export const CHECK_ANEMOMETER =
  "I have checked on-site wind with an anemometer or the crane's jib anemometer before lifting";
export const CHECK_OPERATOR = 'The crane operator retains the final decision to lift, continue or stop';

/** Postponing does not need the confirmations, so an empty box is not a gap in the record. */
export function tickLabel(ticked: boolean, choice: DecisionChoice): string {
  if (ticked) return 'Ticked';
  return choice === 'postpone' ? 'Not ticked (not required for Postpone)' : 'Not ticked';
}

export interface Decision {
  choice: DecisionChoice;
  name: string;
  role: string;
  notes: string;
  anemometerChecked: boolean;
  operatorRetainsDecision: boolean;
}

/** A saved, read-only decision record. Holds everything needed to reproduce the assessment. */
export interface DecisionRecord {
  schema: 1;
  id: string;
  createdAt: string;
  app: string;
  methodVersion: string;
  setup: LiftSetup;
  forecast: {
    source: string;
    endpoint: string;
    fetchedAt: string;
    model: string;
    timezone: string;
    gridLatitude: number;
    gridLongitude: number;
    elevationM: number | null;
  };
  assessment: LiftAssessment;
  decision: Decision;
  /** SHA-256 (hex) of the record without this field. Shows whether a record was altered. */
  integrity: string;
}

export type DecisionErrors = Partial<Record<keyof Decision, string>>;

export function validateDecision(d: Decision): DecisionErrors {
  const e: DecisionErrors = {};
  if (!d.name.trim()) e.name = 'Enter your name.';
  if (!d.role.trim()) e.role = 'Enter your role, e.g. "Appointed Person".';
  if (d.choice === 'proceed-with-conditions' && !d.notes.trim()) e.notes = 'Write down the conditions.';
  if (d.choice !== 'postpone') {
    if (!d.anemometerChecked) e.anemometerChecked = 'Tick to confirm before recording a decision to proceed.';
    if (!d.operatorRetainsDecision) e.operatorRetainsDecision = 'Tick to confirm before recording a decision to proceed.';
  }
  return e;
}

/** JSON with object keys sorted, so the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computeIntegrity(record: Omit<DecisionRecord, 'integrity'> | DecisionRecord): Promise<string> {
  const { integrity: _ignored, ...rest } = record as DecisionRecord;
  return sha256Hex(canonicalJson(rest));
}

export async function verifyRecord(record: DecisionRecord): Promise<boolean> {
  return (await computeIntegrity(record)) === record.integrity;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Builds a timestamped, frozen record. Deep-copies the inputs so later edits on screen cannot change it. */
export async function createRecord(
  setup: LiftSetup,
  forecast: Forecast,
  assessment: LiftAssessment,
  decision: Decision,
  now: Date = new Date(),
  id: string = crypto.randomUUID(),
): Promise<DecisionRecord> {
  const body: Omit<DecisionRecord, 'integrity'> = structuredClone({
    schema: 1 as const,
    id,
    createdAt: now.toISOString(),
    app: APP_NAME,
    methodVersion: METHOD_VERSION,
    setup,
    forecast: {
      source: forecast.source,
      endpoint: forecast.endpoint,
      fetchedAt: forecast.fetchedAt,
      model: forecast.model,
      timezone: forecast.timezone,
      gridLatitude: forecast.latitude,
      gridLongitude: forecast.longitude,
      elevationM: forecast.elevationM,
    },
    assessment,
    decision,
  });
  const record: DecisionRecord = { ...body, integrity: await computeIntegrity(body) };
  return deepFreeze(record);
}
