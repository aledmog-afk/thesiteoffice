import { describe, expect, it } from 'vitest';
import { buildChecksReport, emptyChecks } from '../../src/checks/model';
import { TEST_VERSION_NOTICE } from '../../src/config';
import { assessLift } from '../../src/lift/assessment';
import { createRecord, newDecisionDraft, recordedDecisionText, ROLE_HINT, validateDecision, verifyRecord, type DecisionRecord } from '../../src/lift/record';
import { buildBriefingPdf } from '../../src/pdf/briefingPdf';
import { buildRecordPdf, pdfSafe, TEST_BANNER_RGB } from '../../src/pdf/recordPdf';
import { forecast, panelSetup } from './helpers';

const raw = (glob: Record<string, unknown>) => Object.values(glob)[0] as string;
const files = {
  ...import.meta.glob(['../../index.html', '../../method.html', '../../public/*.html', '../../public/robots.txt', '../../public/_headers'], { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const decisionSrc = raw(import.meta.glob('../../src/ui/screens/decision.ts', { query: '?raw', import: 'default', eager: true }));
const appSrc = raw(import.meta.glob('../../src/ui/app.ts', { query: '?raw', import: 'default', eager: true }));
const methodSrc = raw(import.meta.glob('../../src/method.ts', { query: '?raw', import: 'default', eager: true }));
const css = raw(import.meta.glob('../../src/styles.css', { query: '?raw', import: 'default', eager: true }));

const pdfText = (pdf: string) => [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join('\n');
/** jsPDF writes a fill colour as "r g b rg" with 0-1 values to 2 dp. */
const fillRg = ([r, g, b]: [number, number, number]) => [r, g, b].map((v) => Number((v / 255).toFixed(2)).toString()).join(' ') + ' rg';

async function record(role = 'Lift Supervisor'): Promise<DecisionRecord> {
  const setup = panelSetup();
  const f = forecast(() => 3);
  return createRecord(setup, f, assessLift(setup, f), {
    choice: 'postpone', name: 'A. Person', role, notes: '', anemometerChecked: false, operatorRetainsDecision: false,
  }, new Date('2026-10-22T08:00:00Z'), 'abcdef12-0000-4000-8000-00000000000a', buildChecksReport(emptyChecks(), '2026-10-22'));
}

describe('role field', () => {
  it('starts empty, with no default role, even if an older version stored one', () => {
    expect(newDecisionDraft().role).toBe('');
    expect(newDecisionDraft({ name: 'A. Person', role: 'Appointed Person' } as never)).toMatchObject({ name: 'A. Person', role: '' });
    expect(decisionSrc).not.toMatch(/role: 'Appointed Person'/);
    expect(decisionSrc).toMatch(/JSON\.stringify\(\{ name: d\.name \}\)/); // the role is no longer remembered
  });

  it('is required before a record can be saved, with the hint', () => {
    expect(ROLE_HINT).toBe('e.g. Appointed Person, Lift Supervisor, Crane Operator');
    expect(validateDecision({ ...newDecisionDraft({ name: 'A. Person' }) }).role).toBe(`Enter your role (${ROLE_HINT}).`);
    expect(validateDecision({ ...newDecisionDraft({ name: 'A. Person' }), role: '   ' }).role).toBeTruthy();
    expect(validateDecision({ ...newDecisionDraft({ name: 'A. Person' }), role: 'Crane Operator' }).role).toBeUndefined();
    expect(decisionSrc).toMatch(/field\('Role', role, ROLE_HINT\)/);
  });

  it('older records keep their existing role', async () => {
    const r = await record('Appointed Person');
    expect(r.decision.role).toBe('Appointed Person');
    expect(await verifyRecord(r)).toBe(true);
    expect(recordedDecisionText(r.decision)).toContain('(Appointed Person)');
  });
});

describe('test-version banner', () => {
  it('has the agreed wording', () => {
    expect(TEST_VERSION_NOTICE).toBe('Test version – not for operational use. Feedback only.');
  });

  it('is on every app screen, the method page and the privacy and terms pages', () => {
    expect(appSrc).toMatch(/'div',\s*\{ class: 'top' \},\s*testBanner\(\),/);
    expect(appSrc).toMatch(/class: 'test-banner', role: 'note' \}, TEST_VERSION_NOTICE/);
    expect(methodSrc).toContain('<div class="test-banner" role="note">${TEST_VERSION_NOTICE}</div>');
    for (const page of ['../../public/privacy.html', '../../public/terms.html']) {
      expect(files[page]).toContain('<div class="test-banner" role="note">Test version &ndash; not for operational use. Feedback only.</div>');
    }
  });

  it('is neutral grey, never green, in light and dark themes', () => {
    const values = [...css.matchAll(/--test-bg:\s*#([0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(values.length).toBe(3);
    for (const hex of values) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), hex).toBeLessThanOrEqual(16);
      expect(g, hex).toBeLessThanOrEqual(b);
    }
    const [r, g, b] = TEST_BANNER_RGB;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
  });

  it('is on every page of the record PDF and the briefing sheet', async () => {
    const r = await record();
    const notice = pdfSafe(TEST_VERSION_NOTICE);
    expect(notice).toBe('Test version - not for operational use. Feedback only.');
    for (const doc of [await buildRecordPdf(r, true), await buildBriefingPdf(r)]) {
      const out = doc.output();
      const count = pdfText(out).split('\n').filter((l) => l === notice).length;
      expect(count).toBe(doc.getNumberOfPages());
      expect(out.split(fillRg(TEST_BANNER_RGB)).length - 1).toBeGreaterThanOrEqual(doc.getNumberOfPages());
    }
  });
});

describe('no indexing', () => {
  it('every page has robots noindex, nofollow', () => {
    const pages = Object.keys(files).filter((f) => f.endsWith('.html'));
    expect(pages.sort()).toEqual(['../../index.html', '../../method.html', '../../public/privacy.html', '../../public/terms.html']);
    for (const p of pages) {
      expect(files[p], p).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(files[p].match(/name="robots"/g), p).toHaveLength(1);
    }
  });

  it('robots.txt disallows everything', () => {
    expect(files['../../public/robots.txt']).toBe('User-agent: *\nDisallow: /\n');
  });

  it('the headers also tell crawlers not to index (covers PDFs and other files)', () => {
    expect(files['../../public/_headers']).toMatch(/^\/\*\n(?: {2}.+\n)*  X-Robots-Tag: noindex, nofollow\n/);
  });
});
