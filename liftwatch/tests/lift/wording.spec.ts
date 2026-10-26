import { describe, expect, it } from 'vitest';
import { checksSections } from '../../src/checks/reportLines';
import { buildChecksReport, emptyChecks } from '../../src/checks/model';
import { statusText } from '../../src/lift/display';
import { STATUS_RGB } from '../../src/pdf/recordPdf';
import { STATUS_ICON } from '../../src/ui/format';
import { STATUS_LABEL } from '../../src/wind';
import { STATE_LABEL } from '../../src/windlog/log';

const sources = {
  ...import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../src/**/*.css', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

describe('status wording', () => {
  it('names the result against the permitted speed', () => {
    expect(STATUS_LABEL).toMatchObject({ within: 'Below permitted speed', near: 'Near permitted speed', over: 'Above permitted speed' });
  });

  it('adds the percentage to the banner text', () => {
    expect(statusText('within', 62.4)).toBe('Below permitted speed (62 % of limit)');
    expect(statusText('near', 85)).toBe('Near permitted speed (85 %)');
    expect(statusText('over', 112.3)).toBe('Above permitted speed (112 %)');
    expect(statusText('within', 79.96)).toBe('Below permitted speed (< 80 % of limit)');
    expect(statusText('no-data', null)).toBe('No data');
    expect(statusText('within')).toBe('Below permitted speed');
  });

  it('wind log: the wait elapsing leaves the restart to the crane operator', () => {
    expect(STATE_LABEL.waited).toBe('Wait period elapsed. The crane operator decides whether to restart');
    expect(STATE_LABEL.within).toBe('Below permitted speed');
  });

  it('checks: neutral wording when nothing is flagged or everything is done', () => {
    const r = buildChecksReport(emptyChecks(), '2026-10-22');
    r.attention = [];
    r.incomplete = [];
    const rows = Object.fromEntries(checksSections(r)[0].rows);
    expect(rows['Needs attention']).toBe('No items flagged by these checks');
    expect(rows['Not done']).toBe('All items marked done');
  });
});

describe('no tick and no green for the below state', () => {
  it('uses a plain circle, not a tick, as the below icon', () => {
    expect(STATUS_ICON.within).not.toBe('✓');
    expect(STATUS_ICON.within).toBe('○');
  });

  it('has no tick anywhere a user sees (app, chart, PDFs, wind log)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
    for (const [f, raw] of Object.entries(sources)) {
      // pdfSafe strips ticks from text; that one regex is allowed to name it.
      const text = raw.replace('/[✓✕⚠↻→←]/g', '');
      expect(text.includes('✓'), f).toBe(false);
    }
    expect(sources['../../src/ui/screens/windlog.ts']).toBeTruthy();
  });

  it('the PDF fill for below is blue-grey, not green', () => {
    const [r, g, b] = STATUS_RGB.within;
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    expect(b - r).toBeLessThan(80); // muted, not a saturated blue
  });

  it('the app colours for below are blue-grey in light and dark themes', () => {
    const css = sources['../../src/styles.css'];
    const values = [...css.matchAll(/--within-(?:bg|mark):\s*#([0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(values.length).toBeGreaterThanOrEqual(6);
    for (const hex of values) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(b, hex).toBeGreaterThan(g);
      expect(g, hex).toBeGreaterThanOrEqual(r);
    }
  });
});
