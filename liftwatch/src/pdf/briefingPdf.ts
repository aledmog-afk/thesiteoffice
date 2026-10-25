import type { jsPDF as JsPdf } from 'jspdf';
import { APP_NAME, BANNER_SUFFIX, DISCLAIMER } from '../config';
import { CHECK_OPERATOR, DECISION_LABEL, type DecisionRecord } from '../lift/record';
import { statusText } from '../lift/display';
import { DEFAULT_WAIT_MINUTES, fromMs, UNIT_LABEL, type SpeedUnit } from '../windlog/log';
import { pdfSafe, STATUS_RGB, STATUS_TEXT_RGB, terrainText } from './recordPdf';

const UNITS: SpeedUnit[] = ['ms', 'mph', 'kmh', 'kn'];
const fmt = (ms: number, u: SpeedUnit) => fromMs(ms, u).toFixed(u === 'ms' ? 1 : 0);
const hm = (t: string) => t.slice(11, 16);

/**
 * One-page briefing sheet for the pre-start briefing and the crane cab: the stop
 * reading in every unit an anemometer might show, the loads, the day's flags, the
 * checks that need attention, and space for signatures. CPA 6.1.3: the permissible
 * wind speed should be in the lift plan and briefed to the lifting team.
 */
export async function buildBriefingPdf(record: DecisionRecord): Promise<JsPdf> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `${APP_NAME} briefing ${record.assessment.liftDate}`, author: APP_NAME, creator: APP_NAME });
  const a = record.assessment;
  const s = record.setup;
  const left = 15;
  const width = 180;
  let y = 16;
  const text = (t: string, size: number, bold = false, color: [number, number, number] = [20, 20, 20]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color);
    const lines = doc.splitTextToSize(pdfSafe(t), width) as string[];
    doc.text(lines, left, y);
    y += lines.length * size * 0.42 + 1.5;
  };

  text(`${APP_NAME} - lift briefing`, 18, true, [51, 67, 168]);
  text(`${new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${a.liftDate}T12:00:00Z`))} · ${s.site?.label ?? ''}`, 11, true);
  text(`Crane: ${s.craneDescription}. Boom / jib head ${s.heightM} m. Terrain: ${terrainText(s.terrain, record.methodVersion)}.`, 9.5);
  text(`AP decision: ${DECISION_LABEL[record.decision.choice]} (${record.decision.name}, ${record.decision.role})${record.decision.notes ? ` - ${record.decision.notes}` : ''}`, 9.5, true);

  // Forecast status strip.
  y += 1;
  doc.setFillColor(...STATUS_RGB[a.overallStatus]).roundedRect(left, y, width, 10, 2, 2, 'F');
  doc.setTextColor(...STATUS_TEXT_RGB[a.overallStatus]).setFont('helvetica', 'bold').setFontSize(11);
  doc.text(pdfSafe(`Forecast: ${statusText(a.overallStatus, a.worst?.percentOfLimit)} - ${BANNER_SUFFIX}`), left + 4, y + 6.5);
  y += 15;

  // The stop reading, large, in every unit.
  text('STOP lifting if the crane anemometer gust reading is above:', 12, true);
  const loads = a.loads && a.loads.length ? [...a.loads].sort((x, z) => x.result.permittedMs - z.result.permittedMs) : null;
  const rows: [string, number][] = loads ? loads.map((l) => [l.ref, l.result.permittedMs]) : [['This load', a.load.permittedMs]];
  const colW = [60, 30, 30, 30, 30];
  const header = ['Load', ...UNITS.map((u) => UNIT_LABEL[u])];
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(90, 98, 108);
  let x = left;
  header.forEach((hd, i) => {
    doc.text(hd, i === 0 ? x : x + colW[i] - 2, y, { align: i === 0 ? 'left' : 'right' });
    x += colW[i];
  });
  y += 2;
  for (const [ref, ms] of rows.slice(0, 12)) {
    const big = ref === a.governingRef || rows.length === 1;
    const rh = big ? 9 : 6.5;
    if (big) doc.setFillColor(255, 240, 200).rect(left, y, width, rh, 'F');
    doc.setTextColor(20, 20, 20).setFont('helvetica', 'bold').setFontSize(big ? 15 : 11);
    x = left;
    doc.text(pdfSafe(ref + (big && rows.length > 1 ? ' (governs)' : '')), x + 1, y + rh - 2.4);
    x += colW[0];
    UNITS.forEach((u, i) => {
      doc.text(fmt(ms, u), x + colW[i + 1] - 2, y + rh - 2.4, { align: 'right' });
      x += colW[i + 1];
    });
    y += rh + 0.6;
  }
  if (rows.length > 12) text(`…and ${rows.length - 12} more loads: see the full record.`, 8.5);
  y += 2;
  text(`After a stop, wait until readings stay below the limit for ${DEFAULT_WAIT_MINUTES} minutes before restarting. A reading above the limit restarts the wait. After 3 or 4 restarts, consider winding off for the day (CPA 6.4.3).`, 9.5);
  text(`${CHECK_OPERATOR}.`, 10, true);

  // Window, periods, flags.
  const flags = new Map<string, number>();
  for (const hr of a.windowHours) for (const f of hr.flags) flags.set(f.label, (flags.get(f.label) ?? 0) + 1);
  text(
    `Lift window ${hm(a.windowStart)}-${hm(a.windowEnd)}. Daylight ${a.liftDaySun ? `${hm(a.liftDaySun.sunrise)}-${hm(a.liftDaySun.sunset)}` : 'unknown'}. ` +
      `Planning guidance: ${a.periods.length ? `below permitted speed ${a.periods.map((p) => `${hm(p.start)}-${hm(p.end)}`).join(', ')}` : 'no 2-hour daylight period below permitted speed for the governing load'}.`,
    9.5,
  );
  if (flags.size) text(`Weather flags in the window: ${[...flags].map(([k, n]) => `${k} (${n} h)`).join(', ')}.`, 9.5, true);
  text(`Forecast: ${record.forecast.source}, fetched ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.forecast.fetchedAt))}. Forecasts are estimates: the crane anemometer on the day is what counts.`, 8.5, false, [80, 88, 98]);

  // Checks needing attention.
  if (record.checks) {
    y += 1;
    const att = record.checks.attention;
    text(att.length ? `Checks needing attention (${att.length}):` : 'Checks: nothing flagged.', 10, true, att.length ? [179, 33, 30] : [11, 110, 11]);
    for (const line of att.slice(0, 8)) text(`- ${line}`, 8.5);
    // Results that passed. Flagged ones are already in the list above.
    const calc = [
      ...record.checks.capacity.filter((c) => c.result.band === 'ok').map((c) => `Capacity ${c.label}: ${c.result.message}`),
      ...record.checks.slings.filter((c) => c.result.ok).map((c) => `Slings ${c.label}: ${c.result.message}`),
      ...record.checks.bearing.filter((c) => c.result.ok).map((c) => `Ground ${c.label}: ${c.result.message}`),
    ];
    for (const line of calc.slice(0, 6)) text(line, 8.5);
  }

  // Sign-on: names already recorded plus blank lines for paper signatures.
  const footer = () => {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(70, 76, 84);
    doc.text(doc.splitTextToSize(pdfSafe(DISCLAIMER), width) as string[], left, 284);
  };
  if (y > 240) {
    footer();
    doc.addPage();
    y = 16;
  }
  y += 2;
  text('Briefed to (name, role, signature, time):', 10, true);
  const crew = record.checks?.inputs.crew ?? [];
  const lineH = 7;
  const remaining = Math.max(3, Math.floor((272 - y) / lineH));
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(20, 20, 20).setDrawColor(170, 176, 184).setLineWidth(0.2);
  for (let i = 0; i < Math.min(remaining, Math.max(crew.length + 3, 6)); i++) {
    const m = crew[i];
    if (m) {
      const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(m.signedAt));
      doc.text(pdfSafe(`${m.name}, ${m.role} (signed on in ${APP_NAME} at ${t})`), left, y + 5);
    }
    doc.line(left, y + lineH - 0.5, left + width, y + lineH - 0.5);
    y += lineH;
  }

  footer();
  return doc;
}
