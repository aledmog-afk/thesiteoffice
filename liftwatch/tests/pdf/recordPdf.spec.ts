import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '../../src/config';
import { assessLift } from '../../src/lift/assessment';
import { buildChecksReport, emptyChecks } from '../../src/checks/model';
import { createRecord } from '../../src/lift/record';
import { buildRecordPdf, pdfFilename, pdfSafe } from '../../src/pdf/recordPdf';
import { panelSetup, forecast } from '../lift/helpers';

describe('pdfSafe', () => {
  it('replaces characters the built-in PDF font cannot draw', () => {
    expect(pdfSafe('17 × √(1.2 ÷ r) ≥ 70 % – ok ✓')).toBe('17 × sqrt(1.2 ÷ r) >= 70 % - ok ');
    expect(pdfSafe('8.64 m² at 236°')).toBe('8.64 m² at 236°');
  });
});

describe('buildRecordPdf', () => {
  it('includes the status, method, sources and the required footer on every page', async () => {
    const setup = panelSetup();
    const f = forecast(() => 3);
    const record = await createRecord(setup, f, assessLift(setup, f), {
      choice: 'postpone',
      name: 'A. Person',
      role: 'Appointed Person',
      notes: '',
      anemometerChecked: false,
      operatorRetainsDecision: false,
    }, new Date('2026-10-22T08:00:00Z'), 'abcdef12-0000-4000-8000-000000000000');

    const doc = await buildRecordPdf(record, true);
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThanOrEqual(2);
    const raw = doc.output();
    // jsPDF splits long lines, so check a distinctive start of the footer once per page.
    const footerStart = DISCLAIMER.slice(0, 60);
    expect(raw.split(footerStart).length - 1).toBe(pages);
    expect(raw).toMatch(/Below permitted speed \\\(\d+ % of limit\\\)/); // jsPDF escapes the brackets
    expect(raw).not.toContain('Within limits');
    expect(raw).toContain('Method summary');
    expect(raw).toContain('Sources');
    expect(raw).toContain('Open-Meteo');
    expect(raw).toContain('LW-M1.2');
    expect(raw).toContain('Lift plan LP-014 / LTM 1090 load chart');
    expect(pdfFilename(record)).toBe('LiftWatch-2026-10-22-SW1A1AA-abcdef12.pdf');
  });

  it('includes the checks when a record has them', async () => {
    const setup = panelSetup();
    const f = forecast(() => 3);
    const checks = emptyChecks();
    checks.craneExamDate = '2025-01-01';
    checks.answers.overhead = 'no';
    checks.crew.push({ name: 'C. Operator', role: 'Crane operator', signedAt: '2026-10-22T07:00:00Z' });
    const record = await createRecord(setup, f, assessLift(setup, f), {
      choice: 'postpone', name: 'A. Person', role: 'Appointed Person', notes: '', anemometerChecked: false, operatorRetainsDecision: false,
    }, new Date('2026-10-22T08:00:00Z'), 'abcdef12-0000-4000-8000-000000000001', buildChecksReport(checks, '2026-10-22'));
    const raw = (await buildRecordPdf(record, true)).output();
    expect(raw).toContain('Pre-lift checklist');
    expect(raw).toContain('Crew briefing sign-on');
    expect(raw).toContain('C. Operator');
    expect(raw).toContain('Overhead power lines');
  });
});

describe('buildBriefingPdf', () => {
  it('shows the stop reading in every unit and fits on one page', async () => {
    const { buildBriefingPdf } = await import('../../src/pdf/briefingPdf');
    const setup = panelSetup();
    const f = forecast(() => 3);
    const record = await createRecord(setup, f, assessLift(setup, f), {
      choice: 'proceed', name: 'A. Person', role: 'Appointed Person', notes: '', anemometerChecked: true, operatorRetainsDecision: true,
    }, new Date('2026-10-22T08:00:00Z'), 'abcdef12-0000-4000-8000-000000000002', buildChecksReport(emptyChecks(), '2026-10-22'));
    const doc = await buildBriefingPdf(record);
    expect(doc.getNumberOfPages()).toBe(1);
    const raw = doc.output();
    expect(raw).toContain('STOP lifting if the crane anemometer gust reading is above');
    // 6.59 m/s = 14.7 mph, 23.7 km/h, 12.8 knots
    for (const v of ['6.6', '15', '24', '13']) expect(raw).toContain(`(${v})`);
    expect(raw).toContain('The crane operator retains the final decision');
  });
});
