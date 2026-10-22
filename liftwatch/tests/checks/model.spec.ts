import { describe, expect, it } from 'vitest';
import { buildChecksReport, CHECKLIST, emptyChecks } from '../../src/checks/model';

describe('buildChecksReport', () => {
  it('an empty set of checks is all incomplete, nothing flagged', () => {
    const r = buildChecksReport(emptyChecks(), '2026-10-22');
    expect(r.attention).toEqual([]);
    expect(r.incomplete.length).toBe(2 + 3 + CHECKLIST.length + 1);
  });

  it('flags out-of-date examinations, expired cards, "no" answers and failed calculations', () => {
    const c = emptyChecks();
    c.craneExamDate = '2025-09-01';
    c.accessoriesExamDate = '2026-09-01';
    c.cards[0] = { role: 'Crane operator', holder: 'A. Operator', card: 'CPCS 1', expiry: '2026-01-01' };
    c.answers.overhead = 'no';
    c.answers.weight = 'yes';
    c.capacity.push({ label: 'W12', radiusM: 20, chartCapacityKg: 1000, loadKg: 1300, accessoriesKg: 0, hookBlockKg: 0 });
    c.slings.push({ label: '2-leg', legs: 2, legLengthM: 2, spreadM: 3.6, loadKg: 1000, singleLegWllKg: null });
    c.bearing.push({ label: 'Front left', outriggerLoad: 300, outriggerUnit: 'kN', matLengthM: 1, matWidthM: 1, matMassKg: null, allowableKpa: 150 });
    c.crew.push({ name: 'B. Slinger', role: 'Slinger / signaller', signedAt: '2026-10-22T07:30:00Z' });
    const r = buildChecksReport(c, '2026-10-22');
    expect(r.craneExam.status).toBe('expired');
    expect(r.accessoriesExam.status).toBe('ok');
    const text = r.attention.join('\n');
    expect(text).toMatch(/Crane thorough examination/);
    expect(text).toMatch(/Crane operator card: Expired/);
    expect(text).toMatch(/overhead power lines/i);
    expect(text).toMatch(/Capacity \(W12\)/);
    expect(text).toMatch(/Slings \(2-leg\)/);
    expect(text).toMatch(/Ground bearing \(Front left\)/);
    expect(r.incomplete.join('\n')).not.toMatch(/Crew briefing/);
    expect(r.checklist.find((x) => x.item.id === 'weight')?.answer).toBe('yes');
  });
});
