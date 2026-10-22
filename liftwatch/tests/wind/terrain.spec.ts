import { describe, expect, it } from 'vitest';
import {
  gustHeightFactor,
  OutsideMethodRangeError,
  profileGustRatio,
  TERRAIN,
  terrainHeightFactor,
  type Terrain,
} from '../../src/wind';

describe('profileGustRatio (EN 1991-1-4 peak velocity profile)', () => {
  it('is 1 at 10 m', () => {
    for (const t of ['town', 'city'] as const) expect(profileGustRatio(10, TERRAIN[t].z0, TERRAIN[t].zMin)).toBeCloseTo(1, 12);
  });

  it('for open country (category II) it is within 3 % of the published Liebherr factors', () => {
    for (const h of [50, 100, 150]) {
      const ec = profileGustRatio(h, 0.05, 2);
      const lieb = gustHeightFactor(h);
      expect(Math.abs(ec / lieb - 1)).toBeLessThan(0.03);
    }
  });

  it('matches hand-worked values for town (III) and city (IV)', () => {
    // vp(z) ∝ ln(z/z0) × √(1 + 7 / ln(z/z0)), ratio to 10 m
    expect(profileGustRatio(50, 0.3, 5)).toBeCloseTo(1.297, 3);
    expect(profileGustRatio(100, 0.3, 5)).toBeCloseTo(1.421, 3);
    expect(profileGustRatio(150, 0.3, 5)).toBeCloseTo(1.493, 3);
    expect(profileGustRatio(50, 1.0, 10)).toBeCloseTo(1.412, 3);
    expect(profileGustRatio(100, 1.0, 10)).toBeCloseTo(1.58, 3);
    expect(profileGustRatio(150, 1.0, 10)).toBeCloseTo(1.676, 3);
  });
});

describe('terrainHeightFactor', () => {
  it('open country uses the published factors exactly', () => {
    for (const h of [5, 10, 30, 50, 100, 150]) expect(terrainHeightFactor(h, 'open')).toBe(gustHeightFactor(h));
  });

  it('town and city give higher factors than open country above 10 m', () => {
    for (const h of [15, 30, 50, 100, 150]) {
      expect(terrainHeightFactor(h, 'town')).toBeGreaterThan(terrainHeightFactor(h, 'open'));
      expect(terrainHeightFactor(h, 'city')).toBeGreaterThan(terrainHeightFactor(h, 'town'));
    }
  });

  it('never goes below 1.0 (no reduction below 10 m)', () => {
    for (const t of ['open', 'town', 'city'] as Terrain[]) {
      expect(terrainHeightFactor(3, t)).toBe(1);
      expect(terrainHeightFactor(10, t)).toBe(1);
    }
  });

  it('increases with height for every terrain', () => {
    for (const t of ['open', 'town', 'city'] as Terrain[]) {
      let prev = terrainHeightFactor(10, t);
      for (let h = 11; h <= 150; h++) {
        const f = terrainHeightFactor(h, t);
        expect(f).toBeGreaterThan(prev);
        prev = f;
      }
    }
  });

  it('still refuses above 150 m', () => {
    expect(() => terrainHeightFactor(151, 'city')).toThrow(OutsideMethodRangeError);
  });
});
