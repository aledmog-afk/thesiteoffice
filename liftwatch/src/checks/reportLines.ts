import type { ChecksReport } from './model';

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
      ['Needs attention', r.attention.length ? r.attention.join('; ') : 'No items flagged by these checks'],
      ['Not done', r.incomplete.length ? `${r.incomplete.length} item(s)` : 'All items marked done'],
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
