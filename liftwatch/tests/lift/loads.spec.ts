import { describe, expect, it } from 'vitest';
import { parseLoadSchedule, validateScheduleLoad } from '../../src/lift/loads';

const defaults = { dragCoefficient: 1.2, riggingMassKg: 0 };

describe('parseLoadSchedule', () => {
  it('reads tab-separated rows pasted from a spreadsheet, skipping a header', () => {
    const text = 'Panel\tLength (m)\tHeight (m)\tWeight (kg)\nW01\t3.6\t2.4\t1,300\nW02\t4.8\t2.4\t1 650\n';
    const { loads, errors } = parseLoadSchedule(text, defaults);
    expect(errors).toEqual([]);
    expect(loads.map((l) => [l.ref, l.lengthM, l.heightM, l.massKg])).toEqual([
      ['W01', 3.6, 2.4, 1300],
      ['W02', 4.8, 2.4, 1650],
    ]);
    expect(loads[0].dragCoefficient).toBe(1.2);
    expect(loads[0].id).not.toBe(loads[1].id);
  });

  it('reads comma or semicolon separated rows, with optional rigging and cw', () => {
    const { loads } = parseLoadSchedule('F1,6.0,2.4,900,40,1.3\nF2;5.5;2.4;850', defaults);
    expect(loads[0]).toMatchObject({ ref: 'F1', massKg: 900, riggingMassKg: 40, dragCoefficient: 1.3 });
    expect(loads[1]).toMatchObject({ ref: 'F2', lengthM: 5.5, massKg: 850, riggingMassKg: 0 });
  });

  it('accepts masses in tonnes with a "t" suffix, and kg suffixes', () => {
    const { loads } = parseLoadSchedule('C1\t6\t3\t1.25t\nC2\t6\t3\t980kg', defaults);
    expect(loads.map((l) => l.massKg)).toEqual([1250, 980]);
  });

  it('reports rows it cannot read, with the line number', () => {
    const { loads, errors } = parseLoadSchedule('W01\t3.6\t2.4\t1300\nW02\tthree\t2.4\t1300\nW03\t3.6', defaults);
    expect(loads).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Line 2/);
    expect(errors[1]).toMatch(/Line 3/);
  });

  it('rejects zero or negative sizes and masses', () => {
    const { errors } = parseLoadSchedule('W01\t0\t2.4\t1300\nW02\t3.6\t2.4\t-5', defaults);
    expect(errors).toHaveLength(2);
  });
});

describe('validateScheduleLoad', () => {
  it('names the problem', () => {
    expect(validateScheduleLoad({ id: 'a', ref: '', lengthM: 1, heightM: 1, massKg: 1, riggingMassKg: 0, dragCoefficient: 1.2 })).toMatch(/reference/);
    expect(validateScheduleLoad({ id: 'a', ref: 'X', lengthM: 1, heightM: 1, massKg: 0, riggingMassKg: 0, dragCoefficient: 1.2 })).toMatch(/mass/);
    expect(validateScheduleLoad({ id: 'a', ref: 'X', lengthM: 1, heightM: 1, massKg: 5, riggingMassKg: 0, dragCoefficient: 1.2 })).toBeNull();
  });
});
