import { describe, expect, it } from 'vitest';
import { buildChecksReport, emptyChecks } from '../../src/checks/model';
import { NO_ITEMS_FLAGGED } from '../../src/checks/reportLines';
import { assessLift } from '../../src/lift/assessment';
import { GUST_TIMING_NOTE } from '../../src/lift/display';
import { createRecord, DECISION_LABEL, DECISION_OWNERSHIP, recordedDecisionText, type DecisionChoice } from '../../src/lift/record';
import { buildBriefingPdf } from '../../src/pdf/briefingPdf';
import { buildRecordPdf, CHART_CAPTION, STATUS_RGB } from '../../src/pdf/recordPdf';
import { forecast, panelSetup } from '../lift/helpers';

/** jsPDF writes a fill/text colour as "r g b rg" with 0-1 values to 3 dp. */
const rg = ([r, g, b]: [number, number, number]) => [r, g, b].map((v) => Number((v / 255).toFixed(3)).toString()).join(' ') + ' rg';

/** The text drawn on the page, lines joined with spaces and brackets unescaped. */
const pdfText = (raw: string) =>
  [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join(' ');

async function record(choice: DecisionChoice, checks = buildChecksReport(emptyChecks(), '2026-10-22')) {
  const setup = panelSetup();
  const f = forecast(() => 3);
  const proceeding = choice !== 'postpone';
  return createRecord(setup, f, assessLift(setup, f), {
    choice, name: 'A. Person', role: 'Appointed Person', notes: choice === 'proceed-with-conditions' ? 'Tag lines on every panel' : '',
    anemometerChecked: proceeding, operatorRetainsDecision: proceeding,
  }, new Date('2026-10-22T08:00:00Z'), 'abcdef12-0000-4000-8000-000000000009', checks);
}

describe('briefing sheet: checks with nothing flagged', () => {
  it('says "No items flagged by these checks" in blue-grey, not green', async () => {
    const raw = (await buildBriefingPdf(await record('postpone'))).output();
    expect(raw).toContain(`(${NO_ITEMS_FLAGGED})`);
    expect(raw).not.toMatch(/nothing flagged/i);
    expect(raw).toContain(rg(STATUS_RGB.within));
    expect(raw).not.toContain(rg([11, 110, 11]));
  });
});

describe('PDF chart caption', () => {
  it('names blue-grey below, amber near, red above', async () => {
    expect(CHART_CAPTION).toContain('blue-grey below, amber near, red above');
    expect(CHART_CAPTION).not.toMatch(/green|within|over\b/i);
    const raw = (await buildRecordPdf(await record('postpone'), true)).output();
    expect(raw).toContain('blue-grey below, amber near, red above');
    expect(raw).not.toMatch(/green within/);
  });

  it('explains the gust timing rule under the hourly table', async () => {
    const raw = (await buildRecordPdf(await record('postpone'), true)).output();
    expect(raw.replace(/\)\s*Tj\s*[\d. ]+Td\s*\(/g, ' ')).toContain(GUST_TIMING_NOTE.slice(0, 50));
  });
});

describe('decision labels are the user’s own decision', () => {
  it('on screen: "Your decision: …" for every option', () => {
    expect(DECISION_LABEL).toEqual({
      proceed: 'Your decision: proceed',
      postpone: 'Your decision: postpone',
      'proceed-with-conditions': 'Your decision: proceed with conditions',
    });
    expect(DECISION_OWNERSHIP).toMatch(/not of LiftWatch/);
  });

  it('in the PDF and briefing sheet: recorded by the named person, not LiftWatch', async () => {
    for (const choice of ['proceed', 'postpone', 'proceed-with-conditions'] as DecisionChoice[]) {
      const r = await record(choice);
      const text = recordedDecisionText(r.decision);
      expect(text).toBe(`Decision recorded by A. Person (Appointed Person): ${choice.replace(/-/g, ' ')}`);
      const pdf = (await buildRecordPdf(r, true)).output();
      expect(pdf).toContain(text.replace(/[()]/g, (m) => `\\${m}`)); // jsPDF escapes brackets
      expect(pdf).toContain('not of LiftWatch');
      const brief = pdfText((await buildBriefingPdf(r)).output());
      expect(brief).toContain(`${text}`);
      expect(brief).toContain('Not a LiftWatch decision');
      expect(brief).not.toMatch(/AP decision: (Proceed|Postpone)/);
    }
  });
});
