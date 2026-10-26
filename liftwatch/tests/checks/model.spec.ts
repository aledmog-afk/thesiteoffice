import { describe, expect, it } from 'vitest';
import { buildChecksReport, CHECKLIST, emptyChecks, type LiftChecks } from '../../src/checks/model';
import { checksSections } from '../../src/checks/reportLines';
import { CALCULATORS_UNAVAILABLE, FEATURES } from '../../src/config';

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
    const r = buildChecksReport(c, '2026-10-22', true); // calculators switched on for review
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

describe('high-liability calculators feature flag', () => {
  const withCalcs = (): LiftChecks => {
    const c = emptyChecks();
    c.capacity.push({ label: 'W12', radiusM: 20, chartCapacityKg: 1000, loadKg: 1300, accessoriesKg: 0, hookBlockKg: 0 });
    c.slings.push({ label: '2-leg', legs: 2, legLengthM: 2, spreadM: 3.6, loadKg: 1000, singleLegWllKg: null });
    c.bearing.push({ label: 'FL', outriggerLoad: 300, outriggerUnit: 'kN', matLengthM: 1, matWidthM: 1, matMassKg: null, allowableKpa: 150 });
    return c;
  };

  it('is off by default', () => {
    expect(FEATURES.calculators).toBe(false);
  });

  it('when off, works out, flags and stores nothing for capacity, slings or bearing', () => {
    const r = buildChecksReport(withCalcs(), '2026-10-22');
    expect(r.calculators).toBe(false);
    expect([r.capacity, r.slings, r.bearing, r.inputs.capacity, r.inputs.slings, r.inputs.bearing]).toEqual([[], [], [], [], [], []]);
    expect([...r.attention, ...r.incomplete].join('\n')).not.toMatch(/Capacity|Slings|Ground bearing/);
  });

  it('when off, the record and PDF say the calculators are not available', () => {
    const sections = checksSections(buildChecksReport(withCalcs(), '2026-10-22'));
    const sec = sections.find((s) => s.title === 'Capacity, slings and ground bearing');
    expect(sec?.rows).toEqual([['Calculators', 'Not available: awaiting review by a qualified Appointed Person']]);
    expect(CALCULATORS_UNAVAILABLE).toBe('Not available: awaiting review by a qualified Appointed Person');
    expect(sections.map((s) => s.title)).not.toContain('Crane capacity');
  });

  it('when on, the calculators still run (code kept for the review)', () => {
    const r = buildChecksReport(withCalcs(), '2026-10-22', true);
    expect(r.calculators).toBe(true);
    expect(r.capacity[0].result.band).not.toBe('incomplete');
    expect(r.attention.join('\n')).toMatch(/Capacity \(W12\)/);
    expect(checksSections(r).map((s) => s.title)).toEqual(expect.arrayContaining(['Crane capacity', 'Slings', 'Outrigger ground bearing']));
  });
});
