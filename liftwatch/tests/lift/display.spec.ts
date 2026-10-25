import { describe, expect, it } from 'vitest';
import { percentLabel } from '../../src/lift/display';
import { classifyRatio } from '../../src/wind';

const label = (pct: number) => percentLabel(pct, classifyRatio(pct / 100));

describe('percentLabel', () => {
  it('shows whole numbers away from the thresholds', () => {
    expect(label(70.2)).toBe('70 %');
    expect(label(136.4)).toBe('136 %');
    expect(label(90)).toBe('90 %');
  });

  it('never shows 80 % next to Below permitted speed', () => {
    expect(label(79.6)).toBe('79.6 %');
    expect(label(79.96)).toBe('< 80 %');
    expect(label(79.4)).toBe('79 %');
  });

  it('never shows 100 % next to Above permitted speed', () => {
    expect(label(100.4)).toBe('100.4 %');
    expect(label(100.02)).toBe('> 100 %');
    expect(label(100.6)).toBe('101 %');
  });

  it('shows the thresholds themselves for Near permitted speed', () => {
    expect(label(80)).toBe('80 %');
    expect(label(100)).toBe('100 %');
  });

  it('handles missing values', () => {
    expect(percentLabel(null, 'no-data')).toBe('–');
  });
});
