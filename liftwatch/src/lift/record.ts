import type { ChecksReport } from '../checks/model';
import { APP_NAME, METHOD_VERSION } from '../config';
import type { Forecast } from '../data/openMeteo';
import type { LiftAssessment } from './assessment';
import type { LiftSetup } from './setup';

export type DecisionChoice = 'proceed' | 'postpone' | 'proceed-with-conditions';

/** The choice in plain words. Never shown on its own: always as the person's own decision (below). */
export const DECISION_CHOICE_TEXT: Readonly<Record<DecisionChoice, string>> = Object.freeze({
  proceed: 'proceed',
  postpone: 'postpone',
  'proceed-with-conditions': 'proceed with conditions',
});

/**
 * Decision labels read as the user's own recorded decision, never as LiftWatch's:
 * "Your decision: proceed with conditions". Used on the decision and records screens.
 */
export const DECISION_LABEL: Readonly<Record<DecisionChoice, string>> = Object.freeze({
  proceed: `Your decision: ${DECISION_CHOICE_TEXT.proceed}`,
  postpone: `Your decision: ${DECISION_CHOICE_TEXT.postpone}`,
  'proceed-with-conditions': `Your decision: ${DECISION_CHOICE_TEXT['proceed-with-conditions']}`,
});

/** Shown with every recorded decision. */
export const DECISION_OWNERSHIP = 'This is the decision of the person named, not of LiftWatch. LiftWatch does not make or approve lift decisions.';

/**
 * For PDFs and the briefing sheet, read by other people:
 * "Decision recorded by A. Person (Appointed Person): proceed with conditions".
 */
export function recordedDecisionText(d: { choice: DecisionChoice; name: string; role: string }): string {
  return `Decision recorded by ${d.name} (${d.role}): ${DECISION_CHOICE_TEXT[d.choice]}`;
}

export const CHECK_ANEMOMETER =
  "I have checked on-site wind with an anemometer or the crane's jib anemometer before lifting";
export const CHECK_OPERATOR = 'The crane operator retains the final decision to lift, continue or stop';

/** Postponing does not need the confirmations, so an empty box is not a gap in the record. */
export function tickLabel(ticked: boolean, choice: DecisionChoice): string {
  if (ticked) return 'Ticked';
  return choice === 'postpone' ? 'Not ticked (not required for a decision to postpone)' : 'Not ticked';
}

/** Hint under the Role field. The field itself starts empty: there is no default role. */
export const ROLE_HINT = 'e.g. Appointed Person, Lift Supervisor, Crane Operator';

/**
 * A new decision draft. The name last used on this device is filled in; the role is
 * always left empty so it is chosen each time. Saved records keep their own role.
 */
export function newDecisionDraft(stored: { name?: unknown } = {}): Decision {
  const name = typeof stored.name === 'string' ? stored.name : '';
  return { choice: 'postpone', name, role: '', notes: '', anemometerChecked: false, operatorRetainsDecision: false };
}

export interface Decision {
  choice: DecisionChoice;
  name: string;
  role: string;
  notes: string;
  anemometerChecked: boolean;
  operatorRetainsDecision: boolean;
}

/**
 * How the record's protection is described everywhere. The SHA-256 check has no
 * key, so it detects accidental changes (a damaged file, a hand-edited export) but
 * cannot prove nobody changed the record on purpose: whoever edits it can recompute
 * the check. Never describe records as locked or as proof against tampering.
 */
export const INTEGRITY_NOTE =
  'A timestamped record with an integrity check that detects accidental changes. It is not tamper-proof: anyone who edits a record can also recompute the check.';

/** A saved decision record. Holds everything needed to reproduce the assessment. */
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
  /** Checks screen at the time of saving. Absent on records saved before checks existed. */
  checks?: ChecksReport;
  /** SHA-256 (hex) of the record without this field. Detects accidental changes; not tamper-proof (no key). */
  integrity: string;
}

export type DecisionErrors = Partial<Record<keyof Decision, string>>;

export function validateDecision(d: Decision): DecisionErrors {
  const e: DecisionErrors = {};
  if (!d.name.trim()) e.name = 'Enter your name.';
  if (!d.role.trim()) e.role = `Enter your role (${ROLE_HINT}).`;
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
  checks?: ChecksReport,
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
    ...(checks ? { checks } : {}),
  });
  const record: DecisionRecord = { ...body, integrity: await computeIntegrity(body) };
  return deepFreeze(record);
}
