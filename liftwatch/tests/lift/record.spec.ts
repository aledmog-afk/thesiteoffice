import { describe, expect, it } from 'vitest';
import { assessLift } from '../../src/lift/assessment';
import { createRecord, tickLabel, validateDecision, verifyRecord, type Decision } from '../../src/lift/record';
import { MemoryRecordStore } from '../../src/storage/memory';
import { exportRecords, importRecords } from '../../src/storage/exchange';
import { DuplicateRecordError } from '../../src/storage/types';
import { panelSetup, forecast } from './helpers';

const decision: Decision = {
  choice: 'proceed-with-conditions',
  name: 'A. Person',
  role: 'Appointed Person',
  notes: 'Stop if the jib anemometer reads above 5 m/s.',
  anemometerChecked: true,
  operatorRetainsDecision: true,
};

async function makeRecord(id = 'rec-1', when = '2026-10-22T08:15:00Z') {
  const setup = panelSetup();
  const f = forecast(() => 3);
  return createRecord(setup, f, assessLift(setup, f), decision, new Date(when), id);
}

describe('validateDecision', () => {
  it('needs both ticks to proceed, but not to postpone', () => {
    const e = validateDecision({ ...decision, choice: 'proceed', anemometerChecked: false, operatorRetainsDecision: false });
    expect(e.anemometerChecked).toBeTruthy();
    expect(e.operatorRetainsDecision).toBeTruthy();
    expect(validateDecision({ ...decision, choice: 'postpone', anemometerChecked: false, operatorRetainsDecision: false })).toEqual({});
  });
  it('needs conditions written down', () => {
    expect(validateDecision({ ...decision, notes: '' }).notes).toBeTruthy();
  });
  it('needs a name and role', () => {
    const e = validateDecision({ ...decision, name: '', role: ' ' });
    expect(e.name).toBeTruthy();
    expect(e.role).toBeTruthy();
  });
});

describe('tickLabel', () => {
  it('explains an empty box on a Postpone', () => {
    expect(tickLabel(false, 'postpone')).toBe('Not ticked (not required for a decision to postpone)');
    expect(tickLabel(false, 'proceed')).toBe('Not ticked');
    expect(tickLabel(true, 'postpone')).toBe('Ticked');
  });
});

describe('createRecord', () => {
  it('holds inputs, calculation, forecast values, fetch time and method version', async () => {
    const r = await makeRecord();
    expect(r.createdAt).toBe('2026-10-22T08:15:00.000Z');
    expect(r.methodVersion).toBe('LW-M1.3');
    expect(r.setup.chartLimitSource).toBe('Lift plan LP-014 / LTM 1090 load chart');
    expect(r.assessment.load.permittedMs).toBeCloseTo(6.594, 3);
    expect(r.assessment.liftDayForecast).toHaveLength(25) // lift day + the next hour, for the gust timing rule;
    expect(r.forecast.fetchedAt).toBe('2026-10-21T19:00:00.000Z');
    expect(r.forecast.source).toBe('Open-Meteo');
    expect(r.integrity).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is read-only', async () => {
    const r = await makeRecord();
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.setup)).toBe(true);
    expect(() => {
      (r.decision as { choice: string }).choice = 'proceed';
    }).toThrow(TypeError);
  });

  it('detects a record edited after saving', async () => {
    const r = await makeRecord();
    expect(await verifyRecord(r)).toBe(true);
    const edited = structuredClone(r);
    edited.assessment.load.permittedMs = 17;
    expect(await verifyRecord(edited)).toBe(false);
  });
});

describe('record store and JSON exchange', () => {
  it('never overwrites a saved record', async () => {
    const store = new MemoryRecordStore();
    await store.add(await makeRecord());
    await expect(store.add(await makeRecord())).rejects.toThrow(DuplicateRecordError);
  });

  it('round-trips through export and import', async () => {
    const a = new MemoryRecordStore();
    await a.add(await makeRecord('rec-1', '2026-10-22T08:15:00Z'));
    await a.add(await makeRecord('rec-2', '2026-10-22T09:15:00Z'));
    await a.addLogEntry({ id: 'log-1', recordId: 'rec-1', at: '2026-10-22T09:00:00Z', kind: 'reading', value: 4.2, unit: 'ms', gustMs: 4.2 });
    const json = await exportRecords(a);

    const b = new MemoryRecordStore();
    expect(await importRecords(b, json)).toEqual({ added: 2, skippedExisting: 0, logEntriesAdded: 1, rejected: [] });
    expect((await b.list()).map((r) => r.id)).toEqual(['rec-2', 'rec-1']);
    expect(await importRecords(b, json)).toEqual({ added: 0, skippedExisting: 2, logEntriesAdded: 0, rejected: [] });
    expect((await b.listLog('rec-1'))[0].gustMs).toBe(4.2);
  });

  it('rejects edited records and files that are not exports', async () => {
    const a = new MemoryRecordStore();
    await a.add(await makeRecord());
    const file = JSON.parse(await exportRecords(a));
    file.records[0].decision.choice = 'proceed';
    const result = await importRecords(new MemoryRecordStore(), JSON.stringify(file));
    expect(result.added).toBe(0);
    expect(result.rejected[0].reason).toMatch(/integrity/);
    await expect(importRecords(new MemoryRecordStore(), '{"hello":1}')).rejects.toThrow(/not a LiftWatch records export/);
    await expect(importRecords(new MemoryRecordStore(), 'nope')).rejects.toThrow(/JSON/);
  });
});
