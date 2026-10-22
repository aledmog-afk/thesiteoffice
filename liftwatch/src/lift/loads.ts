/** One load in the day's schedule (e.g. a panel or cassette from the supplier's schedule). */
export interface ScheduleLoad {
  id: string;
  /** Panel or load reference, e.g. "W12" or "FC-03". */
  ref: string;
  /** Length of the face presented to the wind (m). */
  lengthM: number;
  /** Height of the face presented to the wind (m). */
  heightM: number;
  massKg: number;
  /** Rigging, hook block and hoist rope (kg). */
  riggingMassKg: number;
  dragCoefficient: number;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `L${Date.now().toString(36)}${counter.toString(36)}`;
}

const pos = (n: number) => Number.isFinite(n) && n > 0;

/** Null when the load is usable, otherwise what is wrong with it. */
export function validateScheduleLoad(l: ScheduleLoad): string | null {
  if (!l.ref.trim()) return 'Give the load a reference.';
  if (!pos(l.lengthM) || !pos(l.heightM)) return `${l.ref}: length and height must be above zero.`;
  if (!pos(l.massKg)) return `${l.ref}: mass must be above zero.`;
  if (!Number.isFinite(l.riggingMassKg) || l.riggingMassKg < 0) return `${l.ref}: rigging mass must be zero or more.`;
  if (!pos(l.dragCoefficient)) return `${l.ref}: drag coefficient must be above zero.`;
  return null;
}

/** "1,300" "1 300" "1300kg" → 1300; "1.3t" → 1300; anything else → NaN. */
function parseMass(raw: string): number {
  const s = raw.trim().toLowerCase().replace(/(\d)[ ,](?=\d{3}\b)/g, '$1');
  const t = /^([\d.]+)\s*t(onnes?)?$/.exec(s);
  if (t) return Number(t[1]) * 1000;
  const kg = /^([\d.]+)\s*(kg)?$/.exec(s);
  return kg ? Number(kg[1]) : Number.NaN;
}

function parseNum(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return Number.NaN;
  return Number(raw.trim().replace(/\s*m$/i, ''));
}

/**
 * Reads rows pasted from a panel schedule or spreadsheet:
 *   reference, length (m), height (m), mass (kg or "1.3t") [, rigging kg] [, cw]
 * Columns can be separated by tabs, commas or semicolons. A first row that is not
 * numbers is treated as a header. Thousands separators in masses are accepted when
 * the columns are tab or semicolon separated.
 */
export function parseLoadSchedule(
  text: string,
  defaults: { dragCoefficient: number; riggingMassKg: number },
): { loads: ScheduleLoad[]; errors: string[] } {
  const loads: ScheduleLoad[] = [];
  const errors: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const cells = line.split(sep).map((c) => c.trim());
    if (cells.length < 4) {
      errors.push(`Line ${i + 1}: needs reference, length, height and mass ("${line.trim()}").`);
      return;
    }
    const [ref, l, h, m, rig, cw] = cells;
    const load: ScheduleLoad = {
      id: newId(),
      ref,
      lengthM: parseNum(l),
      heightM: parseNum(h),
      massKg: parseMass(m),
      riggingMassKg: rig === undefined || rig === '' ? defaults.riggingMassKg : parseMass(rig),
      dragCoefficient: cw === undefined || cw === '' ? defaults.dragCoefficient : parseNum(cw),
    };
    const numbersMissing = [load.lengthM, load.heightM, load.massKg].some((n) => Number.isNaN(n));
    if (i === lines.findIndex((x) => x.trim()) && numbersMissing) return; // header row
    const problem = numbersMissing ? `${ref || 'row'}: length, height and mass must be numbers.` : validateScheduleLoad(load);
    if (problem) errors.push(`Line ${i + 1}: ${problem}`);
    else loads.push(load);
  });
  return { loads, errors };
}

export function newScheduleLoad(defaults: { dragCoefficient: number; riggingMassKg: number }): ScheduleLoad {
  return { id: newId(), ref: '', lengthM: Number.NaN, heightM: Number.NaN, massKg: Number.NaN, ...defaults };
}
