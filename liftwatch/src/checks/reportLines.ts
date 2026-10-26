import { CALCULATORS_UNAVAILABLE } from '../config';
import type { ChecksReport } from './model';

/** Neutral wording when the checks flag nothing, or everything is marked done. No tick, no green. */
export const NO_ITEMS_FLAGGED = 'No items flagged by these checks';
export const ALL_ITEMS_DONE = 'All items marked done';

const ANSWER: Record<string, string> = { yes: 'Yes', no: 'NO', na: 'N/A' };

/**
 * The checks as label / value pairs, grouped, for the record view and the PDF.
 * Shared so the two never disagree.
 */
export function checksSections(r: ChecksReport): { title: string; rows: [string, string][] }[] {
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso));
  const sections: { title: string; rows: [string, string][] }[] = [];
  sections.push({
    title: 'Summary',
    rows: [
      ['Needs attention', r.attention.length ? r.attention.join('; ') : NO_ITEMS_FLAGGED],
      ['Not done', r.incomplete.length ? `${r.incomplete.length} item(s)` : ALL_ITEMS_DONE],
    ],
  });
  sections.push({
    title: 'Examinations and cards',
    rows: [
      ['Crane examination', `${r.inputs.craneExamDate ?? 'not entered'}: ${r.craneExam.message}`],
      ['Accessories examination', `${r.inputs.accessoriesExamDate ?? 'not entered'}: ${r.accessoriesExam.message}`],
      ...r.cards.map((c): [string, string] => [c.role, `${c.holder || 'not entered'}${c.card ? `, ${c.card}` : ''}: ${c.status.message}`]),
    ],
  });
  sections.push({
    title: 'Pre-lift checklist',
    rows: r.checklist.map(({ item, answer }): [string, string] => [answer ? ANSWER[answer] : 'Not answered', item.text]),
  });
  if (r.calculators === false) {
    sections.push({
      title: 'Capacity, slings and ground bearing',
      rows: [['Calculators', CALCULATORS_UNAVAILABLE]],
    });
  }
  if (r.capacity.length) {
    sections.push({
      title: 'Crane capacity',
      rows: r.capacity.map((x): [string, string] => [
        x.label || 'Capacity',
        x.result.band === 'incomplete'
          ? 'Not finished'
          : `${x.radiusM ?? '?'} m radius, chart ${x.chartCapacityKg} kg; hook load ${Math.round(x.result.totalKg)} kg (load ${x.loadKg} + accessories ${x.accessoriesKg ?? 0} + hook block ${x.hookBlockKg ?? 0}). ${x.result.message}`,
      ]),
    });
  }
  if (r.slings.length) {
    sections.push({
      title: 'Slings',
      rows: r.slings.map((x): [string, string] => [
        x.label || 'Sling',
        `${x.legs} leg(s), ${x.legLengthM ?? '?'} m legs, ${x.spreadM ?? '?'} m between points, ${x.loadKg ?? '?'} kg. ${x.result.message}`,
      ]),
    });
  }
  if (r.bearing.length) {
    sections.push({
      title: 'Outrigger ground bearing',
      rows: r.bearing.map((x): [string, string] => [
        x.label || 'Outrigger',
        `${x.outriggerLoad ?? '?'} ${x.outriggerUnit} on a ${x.matLengthM ?? '?'} × ${x.matWidthM ?? '?'} m mat${x.matMassKg ? ` (${x.matMassKg} kg)` : ''}. ${x.result.message}`,
      ]),
    });
  }
  sections.push({
    title: 'Crew briefing sign-on',
    rows: r.inputs.crew.length ? r.inputs.crew.map((m): [string, string] => [m.name, `${m.role}, signed on ${time(m.signedAt)}`]) : [['Crew', 'Nobody signed on']],
  });
  return sections;
}
