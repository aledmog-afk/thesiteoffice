import { describe, expect, it } from 'vitest';
import { bearingCheck } from '../../src/checks/bearing';
import { capacityCheck } from '../../src/checks/capacity';
import { addMonths, examStatus, expiryStatus } from '../../src/checks/certificates';
import { hookToPointDistance, modeFactor, slingCheck } from '../../src/checks/slings';

describe('capacityCheck', () => {
  const base = { label: 'W12', radiusM: 24, chartCapacityKg: 4000, loadKg: 1300, accessoriesKg: 100, hookBlockKg: 300 };
  it('adds load, accessories and hook block', () => {
    const r = capacityCheck(base);
    expect(r.totalKg).toBe(1700);
    expect(r.utilisation).toBeCloseTo(0.425, 9);
    expect(r.band).toBe('ok');
  });
  it('bands at 75 %, 90 % and 100 %', () => {
    expect(capacityCheck({ ...base, chartCapacityKg: 2267 }).band).toBe('ok'); // 74.99 %
    expect(capacityCheck({ ...base, chartCapacityKg: 2200 }).band).toBe('review'); // 77 %
    expect(capacityCheck({ ...base, chartCapacityKg: 1850 }).band).toBe('high'); // 92 %
    expect(capacityCheck({ ...base, chartCapacityKg: 1700 }).band).toBe('high'); // exactly 100 %
    expect(capacityCheck({ ...base, chartCapacityKg: 1699 }).band).toBe('over');
  });
  it('waits for the essentials', () => {
    expect(capacityCheck({ ...base, chartCapacityKg: null }).band).toBe('incomplete');
    expect(capacityCheck({ ...base, accessoriesKg: null, hookBlockKg: null }).totalKg).toBe(1300);
  });
});

describe('slingCheck (uniform load method)', () => {
  it('mode factors by legs and angle band', () => {
    expect(modeFactor(1, 0)).toBe(1);
    expect(modeFactor(2, 30)).toBe(1.4);
    expect(modeFactor(2, 45)).toBe(1.4);
    expect(modeFactor(2, 50)).toBe(1.0);
    expect(modeFactor(2, 60)).toBe(1.0);
    expect(modeFactor(2, 61)).toBeNull();
    expect(modeFactor(4, 45)).toBe(2.1);
    expect(modeFactor(4, 55)).toBe(1.5);
    expect(modeFactor(3, 20)).toBe(2.1);
  });

  it('works out the angle from leg length and spread', () => {
    expect(hookToPointDistance(2, 3)).toBe(1.5);
    expect(hookToPointDistance(4, 5)).toBe(2.5);
    // 2 legs of 3 m, lifting points 3 m apart: sin β = 1.5 / 3 → 30°
    const r = slingCheck({ legs: 2, legLengthM: 3, spreadM: 3, loadKg: 1400, singleLegWllKg: null });
    expect(r.angleDeg).toBeCloseTo(30, 9);
    expect(r.modeFactor).toBe(1.4);
    expect(r.requiredSingleLegWllKg).toBeCloseTo(1000, 9);
    expect(r.equalShareLegLoadKg).toBeCloseTo(1400 / (2 * Math.cos(Math.PI / 6)), 9);
    expect(r.ok).toBe(true);
  });

  it('flags a sling that is too small and angles over 60°', () => {
    expect(slingCheck({ legs: 2, legLengthM: 3, spreadM: 3, loadKg: 1400, singleLegWllKg: 900 }).ok).toBe(false);
    expect(slingCheck({ legs: 2, legLengthM: 3, spreadM: 3, loadKg: 1400, singleLegWllKg: 1000 }).ok).toBe(true);
    const wide = slingCheck({ legs: 2, legLengthM: 2, spreadM: 3.6, loadKg: 1000, singleLegWllKg: null });
    expect(wide.ok).toBe(false);
    expect(wide.message).toMatch(/over 60°/);
    expect(slingCheck({ legs: 2, legLengthM: 1, spreadM: 3, loadKg: 1000, singleLegWllKg: null }).message).toMatch(/too short/);
  });

  it('4-leg at 50° uses factor 1.5', () => {
    // half-diagonal 2.298 m with 3 m legs → β = 50°
    const diag = 2 * 3 * Math.sin((50 * Math.PI) / 180);
    const r = slingCheck({ legs: 4, legLengthM: 3, spreadM: diag, loadKg: 3000, singleLegWllKg: 2000 });
    expect(r.angleDeg).toBeCloseTo(50, 9);
    expect(r.modeFactor).toBe(1.5);
    expect(r.requiredSingleLegWllKg).toBeCloseTo(2000, 9);
    expect(r.ok).toBe(true);
  });
});

describe('bearingCheck', () => {
  it('pressure = (outrigger load + mat weight) / area', () => {
    // 20 t on a 1.5 × 1.5 m mat of 150 kg: (196.2 + 1.4715) / 2.25 = 87.85 kN/m²
    const r = bearingCheck({ outriggerLoad: 20, outriggerUnit: 't', matLengthM: 1.5, matWidthM: 1.5, matMassKg: 150, allowableKpa: 100 });
    expect(r.pressureKpa).toBeCloseTo(87.854, 3);
    expect(r.ok).toBe(true);
    expect(r.minAreaM2).toBeCloseTo(1.962, 3);
  });
  it('flags overstress and suggests the mat area', () => {
    const r = bearingCheck({ outriggerLoad: 300, outriggerUnit: 'kN', matLengthM: 1, matWidthM: 1, matMassKg: null, allowableKpa: 150 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/2\.00 m²/);
  });
  it('waits for inputs', () => {
    expect(bearingCheck({ outriggerLoad: null, outriggerUnit: 't', matLengthM: 1, matWidthM: 1, matMassKg: null, allowableKpa: 100 }).incomplete).toBe(true);
  });
});

describe('LOLER dates', () => {
  it('adds months, clamping month ends', () => {
    expect(addMonths('2026-04-15', 6)).toBe('2026-10-15');
    expect(addMonths('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonths('2025-10-22', 12)).toBe('2026-10-22');
  });
  it('crane 12 months, accessories 6 months', () => {
    expect(examStatus('2025-10-22', '2026-10-22', 12).status).toBe('ok');
    expect(examStatus('2025-10-21', '2026-10-22', 12).status).toBe('expired');
    expect(examStatus('2026-04-23', '2026-10-22', 6).status).toBe('ok');
    expect(examStatus('2026-04-21', '2026-10-22', 6).status).toBe('expired');
    expect(examStatus(null, '2026-10-22', 6).status).toBe('missing');
    expect(examStatus('2026-11-01', '2026-10-22', 6).status).toBe('future');
  });
  it('card expiry', () => {
    expect(expiryStatus('2026-10-22', '2026-10-22').status).toBe('ok');
    expect(expiryStatus('2026-10-21', '2026-10-22').status).toBe('expired');
  });
});
