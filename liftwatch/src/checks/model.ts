import { FEATURES } from '../config';
import { bearingCheck, type BearingInput, type BearingResult } from './bearing';
import { capacityCheck, type CapacityInput, type CapacityResult } from './capacity';
import { ACCESSORY_EXAM_MONTHS, CRANE_EXAM_MONTHS, examStatus, expiryStatus, type ExamStatus } from './certificates';
import { slingCheck, type SlingInput, type SlingResult } from './slings';

export type Answer = 'yes' | 'no' | 'na' | null;

export interface ChecklistItem {
  id: string;
  text: string;
  /** Where the item comes from, shown under it. */
  why: string;
}

/**
 * Pre-lift checks drawn from the usual reasons lift plans fail review and from the
 * CPA/TCIG wind guide. A "no" is shown as needing attention; it does not stop a
 * record being saved, because the AP decides.
 */
export const CHECKLIST: readonly ChecklistItem[] = Object.freeze([
  { id: 'weight', text: 'Load weights confirmed from drawings, schedules or weighing, not estimated', why: 'Unverified weight is a common reason plans are rejected' },
  { id: 'lifting-points', text: 'Lifting points or panel lifting brackets are as designed and inspected', why: 'Panel lifting points must be approved for the weight' },
  { id: 'ground', text: 'Ground and outrigger set-up as the plan: mats, full extension, level', why: 'Ground failure under an outrigger is a leading cause of overturning' },
  { id: 'services', text: 'Underground services, voids and excavations near the outriggers checked', why: 'Hidden voids can collapse under outrigger loads' },
  { id: 'overhead', text: 'Overhead power lines identified and controls in place', why: 'HSE GS6, Avoiding danger from overhead power lines' },
  { id: 'exclusion', text: 'Exclusion zone set out around the load path and slew, not only the crane', why: 'Zones drawn round the crane base miss the load’s swept area' },
  { id: 'public', text: 'Public, roads and neighbours protected where loads pass over or near', why: 'LOLER: lifts over people to be avoided or controlled' },
  { id: 'anemometer', text: 'Crane anemometer working and reading 3-second gusts', why: 'CPA 3.3 and 5.2: decide on gusts at the jib head' },
  { id: 'comms', text: 'Radio channel and signals agreed, with a back-up', why: 'BS 7121: clear communication between operator and slinger/signaller' },
  { id: 'load-control', text: 'Taglines or other load control available and briefed', why: 'CPA 5.3: taglines for final positioning, not to fight the wind' },
  { id: 'temporary-works', text: 'Temporary bracing or propping ready for placed panels', why: 'STA guidance: temporary stability of erected panels' },
  { id: 'lighting', text: 'Lighting adequate if lifting outside daylight', why: 'Night hours are flagged on the assessment' },
  { id: 'rescue', text: 'Emergency and rescue arrangements agreed', why: 'Including recovery of a load left suspended' },
  { id: 'briefed', text: 'Lift plan briefed to the whole lifting team', why: 'Record names under Crew briefing' },
]);

export interface CardCheck {
  role: string;
  holder: string;
  /** Card scheme and number, e.g. "CPCS 1234567 A60". */
  card: string;
  expiry: string | null;
}

export interface CrewMember {
  name: string;
  role: string;
  /** When they signed on to the briefing (ISO). */
  signedAt: string;
}

export interface LabelledSling extends SlingInput {
  label: string;
}

export interface LabelledBearing extends BearingInput {
  label: string;
}

/** Everything entered on the Checks screen. */
export interface LiftChecks {
  craneExamDate: string | null;
  accessoriesExamDate: string | null;
  cards: CardCheck[];
  answers: Record<string, Answer>;
  capacity: CapacityInput[];
  slings: LabelledSling[];
  bearing: LabelledBearing[];
  crew: CrewMember[];
}

export function emptyChecks(): LiftChecks {
  return {
    craneExamDate: null,
    accessoriesExamDate: null,
    cards: [
      { role: 'Crane operator', holder: '', card: '', expiry: null },
      { role: 'Slinger / signaller', holder: '', card: '', expiry: null },
      { role: 'Lift supervisor', holder: '', card: '', expiry: null },
    ],
    answers: {},
    capacity: [],
    slings: [],
    bearing: [],
    crew: [],
  };
}

export type ItemState = 'ok' | 'attention' | 'incomplete';

/** The checks with every result worked out, as stored in a record. */
export interface ChecksReport {
  inputs: LiftChecks;
  craneExam: ExamStatus;
  accessoriesExam: ExamStatus;
  cards: (CardCheck & { status: ExamStatus })[];
  capacity: (CapacityInput & { result: CapacityResult })[];
  slings: (LabelledSling & { result: SlingResult })[];
  bearing: (LabelledBearing & { result: BearingResult })[];
  checklist: { item: ChecklistItem; answer: Answer }[];
  /**
   * False when the capacity, sling and bearing calculators were switched off
   * (`FEATURES.calculators`): those lists are then empty. Absent on older records,
   * which always ran them.
   */
  calculators?: boolean;
  /** Short lines for summaries: what needs attention and what is not done. */
  attention: string[];
  incomplete: string[];
}

export function buildChecksReport(c: LiftChecks, liftDate: string, calculators: boolean = FEATURES.calculators): ChecksReport {
  const craneExam = examStatus(c.craneExamDate, liftDate, CRANE_EXAM_MONTHS);
  const accessoriesExam = examStatus(c.accessoriesExamDate, liftDate, ACCESSORY_EXAM_MONTHS);
  const cards = c.cards.map((card) => ({ ...card, status: expiryStatus(card.expiry, liftDate) }));
  // Switched off: nothing is worked out, flagged or stored for these three.
  const capacity = calculators ? c.capacity.map((x) => ({ ...x, result: capacityCheck(x) })) : [];
  const slings = calculators ? c.slings.map((x) => ({ ...x, result: slingCheck(x) })) : [];
  const bearing = calculators ? c.bearing.map((x) => ({ ...x, result: bearingCheck(x) })) : [];
  const inputs = calculators ? c : { ...c, capacity: [], slings: [], bearing: [] };
  const checklist = CHECKLIST.map((item) => ({ item, answer: c.answers[item.id] ?? null }));

  const attention: string[] = [];
  const incomplete: string[] = [];
  const exam = (name: string, s: ExamStatus) => {
    if (s.status === 'missing') incomplete.push(`${name}: no date`);
    else if (s.status !== 'ok') attention.push(`${name}: ${s.message}`);
  };
  exam('Crane thorough examination', craneExam);
  exam('Accessories thorough examination', accessoriesExam);
  for (const card of cards) {
    if (!card.holder.trim() && card.status.status === 'missing') incomplete.push(`${card.role} card: not entered`);
    else if (card.status.status === 'missing') incomplete.push(`${card.role} card: no expiry date`);
    else if (card.status.status !== 'ok') attention.push(`${card.role} card: ${card.status.message}`);
  }
  for (const x of capacity) {
    if (x.result.band === 'incomplete') incomplete.push(`Capacity (${x.label || 'unnamed'}): not finished`);
    else if (x.result.band !== 'ok') attention.push(`Capacity (${x.label || 'unnamed'}): ${x.result.message}`);
  }
  for (const x of slings) {
    if (x.result.incomplete) incomplete.push(`Slings (${x.label || 'unnamed'}): not finished`);
    else if (!x.result.ok) attention.push(`Slings (${x.label || 'unnamed'}): ${x.result.message}`);
  }
  for (const x of bearing) {
    if (x.result.incomplete) incomplete.push(`Ground bearing (${x.label || 'unnamed'}): not finished`);
    else if (!x.result.ok) attention.push(`Ground bearing (${x.label || 'unnamed'}): ${x.result.message}`);
  }
  for (const { item, answer } of checklist) {
    if (answer === 'no') attention.push(`Not confirmed: ${item.text}`);
    else if (answer === null) incomplete.push(`Not answered: ${item.text}`);
  }
  if (c.crew.length === 0) incomplete.push('Crew briefing: nobody signed on');

  return { inputs, craneExam, accessoriesExam, cards, capacity, slings, bearing, checklist, calculators, attention, incomplete };
}
