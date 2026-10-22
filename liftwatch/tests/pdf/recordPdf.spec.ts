import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '../../src/config';
import { assessLift } from '../../src/lift/assessment';
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
    expect(raw).toContain('Within limits');
    expect(raw).toContain('Method summary');
    expect(raw).toContain('Sources');
    expect(raw).toContain('Open-Meteo');
    expect(raw).toContain('LW-M1.1');
    expect(raw).toContain('Lift plan LP-014 / LTM 1090 load chart');
    expect(pdfFilename(record)).toBe('LiftWatch-2026-10-22-SW1A1AA-abcdef12.pdf');
  });
});
