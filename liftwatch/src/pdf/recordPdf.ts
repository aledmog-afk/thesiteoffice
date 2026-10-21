import type { jsPDF as JsPdf } from 'jspdf';
import { APP_NAME, BANNER_SUFFIX, DISCLAIMER } from '../config';
import { METHOD_SOURCES, METHOD_SUMMARY } from '../lift/methodSummary';
import { CHECK_ANEMOMETER, CHECK_OPERATOR, DECISION_LABEL, type DecisionRecord } from '../lift/record';
import { compassPoint, msToMph, STATUS_LABEL, type HourAssessment, type Status } from '../wind';

/**
 * The PDF uses jsPDF's built-in Helvetica, which only covers Latin-1. Characters
 * outside it are replaced with plain equivalents.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/√/g, 'sqrt')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[✓✕⚠↻→←]/g, '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}

const STATUS_RGB: Record<Status, [number, number, number]> = {
  within: [11, 110, 11],
  near: [250, 178, 25],
  over: [179, 33, 30],
  'no-data': [84, 94, 105],
};
const STATUS_TEXT_RGB: Record<Status, [number, number, number]> = {
  within: [255, 255, 255],
  near: [17, 17, 17],
  over: [255, 255, 255],
  'no-data': [255, 255, 255],
};

const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '-' : v.toFixed(1));
const spd = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v.toFixed(1)} m/s (${msToMph(v).toFixed(0)} mph)`);
const pc = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v)} %`);
const hm = (t: string) => t.slice(11, 16);
const ukInstant = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
const longDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

class Layout {
  y = 18;
  readonly left = 15;
  readonly width = 180;
  readonly bottom = 270;

  constructor(readonly doc: JsPdf) {}

  ensure(space: number): void {
    if (this.y + space > this.bottom) {
      this.doc.addPage();
      this.y = 18;
    }
  }

  /** `keep` reserves room for what follows, so a heading never ends a page on its own. */
  heading(text: string, keep = 20): void {
    this.ensure(10 + keep);
    this.y += 3;
    this.doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20, 20, 20);
    this.doc.text(pdfSafe(text), this.left, this.y);
    this.y += 2;
    this.doc.setDrawColor(51, 67, 168).setLineWidth(0.5).line(this.left, this.y, this.left + this.width, this.y);
    this.y += 5;
  }

  para(text: string, size = 9.5, bold = false, color: [number, number, number] = [30, 30, 30]): void {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color);
    const lines = this.doc.splitTextToSize(pdfSafe(text), this.width) as string[];
    const lh = size * 0.42;
    for (const line of lines) {
      this.ensure(lh);
      this.doc.text(line, this.left, this.y);
      this.y += lh;
    }
    this.y += 1.2;
  }

  /** Label / value rows. */
  kv(rows: [string, string][]): void {
    const labelW = 52;
    for (const [k, v] of rows) {
      this.doc.setFontSize(9.5);
      const lines = this.doc.splitTextToSize(pdfSafe(v || '-'), this.width - labelW) as string[];
      const lh = 4;
      this.ensure(lines.length * lh + 1);
      this.doc.setFont('helvetica', 'bold').setTextColor(80, 88, 98).text(pdfSafe(k), this.left, this.y);
      this.doc.setFont('helvetica', 'normal').setTextColor(20, 20, 20);
      lines.forEach((line, i) => this.doc.text(line, this.left + labelW, this.y + i * lh));
      this.y += lines.length * lh + 1;
    }
    this.y += 1;
  }
}

function statusBox(L: Layout, status: Status): void {
  const { doc } = L;
  L.ensure(18);
  doc.setFillColor(...STATUS_RGB[status]).roundedRect(L.left, L.y, L.width, 15, 2, 2, 'F');
  doc.setTextColor(...STATUS_TEXT_RGB[status]);
  doc.setFont('helvetica', 'bold').setFontSize(15).text(pdfSafe(STATUS_LABEL[status]), L.left + 5, L.y + 7);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).text(pdfSafe(`- ${BANNER_SUFFIX}`), L.left + 5, L.y + 12);
  L.y += 20;
}

function chart(L: Layout, hours: HourAssessment[], permitted: number): void {
  const { doc } = L;
  const h = 48;
  L.ensure(h + 12);
  const x0 = L.left + 10;
  const w = L.width - 10;
  const top = L.y;
  const base = top + h;
  const max = Math.max(permitted, ...hours.map((x) => x.gustAtHeightMs ?? 0)) * 1.15;
  const y = (v: number) => base - (v / max) * h;
  const slot = w / Math.max(hours.length, 1);

  hours.forEach((hr, i) => {
    if (!hr.daylight) doc.setFillColor(232, 234, 242).rect(x0 + i * slot, top, slot, h, 'F');
  });
  doc.setDrawColor(200, 205, 212).setLineWidth(0.2);
  const step = max > 20 ? 5 : 2;
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(90, 98, 108);
  for (let v = 0; v <= max; v += step) {
    doc.line(x0, y(v), x0 + w, y(v));
    doc.text(String(v), x0 - 2, y(v) + 1, { align: 'right' });
  }
  hours.forEach((hr, i) => {
    if (hr.gustAtHeightMs === null) return;
    doc.setFillColor(...STATUS_RGB[hr.status]);
    const bh = base - y(hr.gustAtHeightMs);
    doc.rect(x0 + i * slot + 0.4, base - bh, slot - 0.8, bh, 'F');
    if (i % 3 === 0) doc.setTextColor(90, 98, 108).text(hm(hr.time).slice(0, 2), x0 + i * slot + slot / 2, base + 3.5, { align: 'center' });
  });
  doc.setDrawColor(20, 20, 20).setLineWidth(0.5).setLineDashPattern([1.5, 1], 0);
  doc.line(x0, y(permitted), x0 + w, y(permitted));
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold').setTextColor(20, 20, 20).text(pdfSafe(`Permitted ${permitted.toFixed(1)} m/s`), x0 + w, y(permitted) - 1.2, { align: 'right' });
  L.y = base + 7;
  L.para('Bars: gust at height (m/s), coloured by status (green within, amber near, red over). Dashed line: permitted limit. Shaded: night. Values in the table below.', 8, false, [90, 98, 108]);
}

function hourTable(L: Layout, hours: HourAssessment[]): void {
  const { doc } = L;
  const cols: [string, number, 'left' | 'right'][] = [
    ['Time', 13, 'left'],
    ['10 m gust', 17, 'right'],
    ['At height', 17, 'right'],
    ['% limit', 14, 'right'],
    ['Status', 24, 'left'],
    ['Dir', 14, 'right'],
    ['Flags', 81, 'left'],
  ];
  const row = (cells: string[], bold: boolean, shade: boolean) => {
    doc.setFontSize(7.5);
    const flagLines = doc.splitTextToSize(pdfSafe(cells[6]), cols[6][1] - 2) as string[];
    const rh = Math.max(4, flagLines.length * 3.2 + 0.8);
    L.ensure(rh);
    if (shade) doc.setFillColor(238, 240, 246).rect(L.left, L.y - 3, L.width, rh, 'F');
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setTextColor(25, 25, 25);
    let x = L.left;
    cols.forEach(([, w, align], i) => {
      if (i === 6) flagLines.forEach((line, j) => doc.text(line, x + 1, L.y + j * 3.2));
      else doc.text(pdfSafe(cells[i]), align === 'right' ? x + w - 1 : x + 1, L.y, { align });
      x += w;
    });
    L.y += rh;
  };
  row(cols.map((c) => c[0]), true, false);
  for (const hr of hours) {
    row(
      [
        hm(hr.time),
        n1(hr.gust10mMs),
        n1(hr.gustAtHeightMs),
        pc(hr.percentOfLimit),
        STATUS_LABEL[hr.status],
        hr.windDirectionDeg === null ? '-' : `${compassPoint(hr.windDirectionDeg)} ${Math.round(hr.windDirectionDeg)}°`,
        hr.flags.map((f) => f.label).join(', ') || '-',
      ],
      false,
      !hr.daylight,
    );
  }
  L.para('Speeds in m/s. Shaded rows: outside daylight.', 8, false, [90, 98, 108]);
}

/** Builds the PDF for a record. jsPDF is loaded on demand to keep the app quick to open. */
export async function buildRecordPdf(record: DecisionRecord, integrityOk: boolean): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${APP_NAME} record ${record.id}`, author: APP_NAME, creator: APP_NAME, subject: 'Lift wind assessment record' });
  const L = new Layout(doc);
  const s = record.setup;
  const a = record.assessment;
  const d = record.decision;
  const w = a.worst;

  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(51, 67, 168).text(APP_NAME, L.left, L.y);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60, 60, 60).text('Lift wind assessment and decision record', L.left + 36, L.y);
  L.y += 6;
  L.para(`Record ${record.id} · saved ${ukInstant(record.createdAt)} · method ${record.methodVersion}`, 8.5, false, [90, 98, 108]);
  L.para('Decision support only. This record is not an authorisation to lift.', 9, true);

  statusBox(L, a.overallStatus);

  L.heading('Decision');
  L.kv([
    ['Decision', DECISION_LABEL[d.choice]],
    ['Name', d.name],
    ['Role', d.role],
    ['Notes / conditions', d.notes || '-'],
    [d.anemometerChecked ? 'Ticked' : 'NOT ticked', CHECK_ANEMOMETER],
    [d.operatorRetainsDecision ? 'Ticked' : 'NOT ticked', CHECK_OPERATOR],
  ]);

  L.heading('Lift');
  L.kv([
    ['Site', `${s.site?.label ?? '-'} (${s.site ? `${s.site.latitude.toFixed(4)}, ${s.site.longitude.toFixed(4)}` : '-'})`],
    ['Lift date', longDate(a.liftDate)],
    ['Window assessed', `${hm(a.windowStart)}-${hm(a.windowEnd)}${a.windowDefaulted ? ' (sunrise to sunset)' : ' (planned)'}`],
    ['Crane', s.craneDescription],
    ['Chart wind limit', `${spd(s.chartLimitMs)}, ${s.chartLimitType === 'gust' ? '3-second gust' : s.chartLimitType ?? '-'}`],
    ['Source of the limit', s.chartLimitSource],
    ['Height for correction', `${s.heightM} m`],
    ['Load', `${s.loadDescription || 'Flat load'}: ${s.loadLengthM} m × ${s.loadHeightM} m, ${s.loadMassKg} kg + ${s.riggingMassKg} kg rigging, cw ${s.dragCoefficient}`],
  ]);

  L.heading('Calculation');
  L.kv(a.load.steps.map((st) => [st.label, `${st.formula} = ${st.value.toFixed(st.unit === 'm/s' ? 2 : 3)} ${st.unit}`]));
  L.kv([
    ['Permitted wind speed', spd(a.load.permittedMs)],
    ['Gust factor at height', `${a.heightFactor.toFixed(3)} at ${a.heightM} m`],
    ['Worst hour in window', w ? `${hm(w.time)}: gust at height ${spd(w.gustAtHeightMs)} (10 m gust ${n1(w.gust10mMs)} m/s) = ${pc(w.percentOfLimit)} of permitted` : '-'],
    ['Direction (worst hour)', w?.windDirectionDeg != null ? `from ${compassPoint(w.windDirectionDeg)} (${Math.round(w.windDirectionDeg)}°)` : '-'],
  ]);

  L.heading('Forecast used');
  L.kv([
    ['Source', `${record.forecast.source} (${record.forecast.endpoint})`],
    ['Model', record.forecast.model],
    ['Fetched', ukInstant(record.forecast.fetchedAt)],
    ['Grid point', `${record.forecast.gridLatitude.toFixed(3)}, ${record.forecast.gridLongitude.toFixed(3)}${record.forecast.elevationM !== null ? `, ${Math.round(record.forecast.elevationM)} m elevation` : ''}`],
    ['Sunrise / sunset', a.liftDaySun ? `${hm(a.liftDaySun.sunrise)} / ${hm(a.liftDaySun.sunset)}` : '-'],
  ]);

  L.heading(`Lift day hour by hour: gust at ${a.heightM} m`, 60);
  chart(L, a.liftDayHours, a.load.permittedMs);
  hourTable(L, a.liftDayHours);

  L.heading('Planning guidance only');
  L.para(
    a.periods.length
      ? `Daylight periods within limits (2 h or more): ${a.periods.map((p) => `${hm(p.start)}-${hm(p.end)}`).join(', ')}.`
      : 'No daylight period of 2 hours or more within limits on the lift day.',
  );
  L.para('Outlook - planning guidance only (worst daylight hour each day):', 9.5, true);
  L.kv(a.outlook.map((o) => [o.date, `${o.worstStatus ? STATUS_LABEL[o.worstStatus] : 'No daylight data'}, max ${spd(o.maxGustAtHeightMs)} at height, ${o.daylightHoursWithin} of ${o.daylightHours} daylight hours within`]));

  L.heading('Method summary');
  METHOD_SUMMARY.forEach((line) => L.para(line, 8.5));
  L.heading('Sources');
  METHOD_SOURCES.forEach((line) => L.para(`- ${line}`, 8.5));
  L.heading('Record integrity');
  L.para(`SHA-256 ${record.integrity}`, 8);
  L.para(integrityOk ? 'The record content matched this hash when the PDF was made.' : 'WARNING: the record content does NOT match its hash. It may have been altered after saving.', 8.5, !integrityOk);

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(190, 196, 204).setLineWidth(0.2).line(L.left, 277, L.left + L.width, 277);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(70, 76, 84);
    doc.text(doc.splitTextToSize(pdfSafe(DISCLAIMER), L.width - 22) as string[], L.left, 281);
    doc.text(`Page ${p} of ${pages}`, L.left + L.width, 281, { align: 'right' });
  }
  return doc;
}

export function pdfFilename(record: DecisionRecord): string {
  const site = (record.setup.site?.postcode ?? 'site').replace(/\s+/g, '');
  return `${APP_NAME}-${record.assessment.liftDate}-${site}-${record.id.slice(0, 8)}.pdf`;
}
