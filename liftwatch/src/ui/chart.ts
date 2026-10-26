import { HOUR_MS } from '../time/london';
import { hourStartMs, type HourAssessment } from '../wind';
import { clear, h, s } from './dom';
import { hhmm, ms } from './format';

export interface ChartOptions {
  hours: HourAssessment[];
  permittedMs: number;
  /** The lift window as instants. */
  windowStartMs: number;
  windowEndMs: number;
  selected: string | null;
  onSelect: (time: string) => void;
}

function niceStep(max: number): number {
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Bar with a 4 px rounded top, anchored square on the baseline. */
function barPath(x: number, y: number, w: number, baseline: number): string {
  const r = Math.min(4, w / 2, (baseline - y) / 2);
  return `M${x},${baseline}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${baseline}Z`;
}

/**
 * Hourly bars of gust at hook height for the lift day, coloured by status, with
 * the permitted limit as a dashed line and night hours shaded. Redraws to the
 * container width so text stays readable on a phone.
 */
export function hourlyChart(opts: ChartOptions): HTMLElement {
  const wrap = h('div', { class: 'chart-wrap' });
  let lastWidth = 0;

  const draw = () => {
    const width = Math.max(280, Math.round(wrap.clientWidth || 340));
    if (width === lastWidth) return;
    lastWidth = width;
    clear(wrap);
    wrap.append(build(width, opts));
  };

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(draw).observe(wrap);
  requestAnimationFrame(draw);
  return wrap;
}

function build(width: number, o: ChartOptions): SVGElement {
  const height = 240;
  const m = { l: 34, r: 8, t: 22, b: 26 };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const n = Math.max(o.hours.length, 1);
  const slot = pw / n;
  const barW = Math.max(3, slot - 2); // 2 px surface gap between bars
  const maxGust = Math.max(0, ...o.hours.map((x) => x.gustAtHeightMs ?? 0));
  const step = niceStep(Math.max(maxGust, o.permittedMs) * 1.15);
  const yMax = Math.ceil((Math.max(maxGust, o.permittedMs) * 1.15) / step) * step;
  const y = (v: number) => m.t + ph - (v / yMax) * ph;
  const x = (i: number) => m.l + i * slot;
  const base = m.t + ph;

  const svg = s('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    tabindex: 0,
    'aria-label': 'Hourly gust at hook height against the permitted limit. Use the left and right arrow keys to step through hours; the table below lists every hour.',
  });

  // Night shading (behind everything).
  o.hours.forEach((hr, i) => {
    if (!hr.daylight) svg.append(s('rect', { class: 'night', x: x(i), y: m.t, width: slot + 0.5, height: ph }));
  });

  // Grid and y labels (recessive).
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    svg.append(s('line', { class: v === 0 ? 'axis' : 'grid', x1: m.l, x2: width - m.r, y1: y(v), y2: y(v) }));
    svg.append(s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(+v.toFixed(1))));
  }
  svg.append(s('text', { x: 2, y: 12 }, 'm/s'));

  // Planned window band along the top of the plot.
  const inWindow = o.hours
    .map((hr, i) => ({ i, on: hourStartMs(hr) + HOUR_MS > o.windowStartMs && hourStartMs(hr) < o.windowEndMs }))
    .filter((z) => z.on);
  if (inWindow.length) {
    const a = inWindow[0].i;
    const b = inWindow[inWindow.length - 1].i;
    svg.append(s('rect', { class: 'window', x: x(a) + 1, y: m.t - 8, width: (b - a + 1) * slot - 2, height: 4, rx: 2 }));
  }

  // Bars.
  o.hours.forEach((hr, i) => {
    const bx = x(i) + (slot - barW) / 2;
    if (hr.gustAtHeightMs === null) {
      svg.append(s('text', { x: x(i) + slot / 2, y: base - 4, 'text-anchor': 'middle' }, '?'));
    } else {
      const top = Math.min(y(hr.gustAtHeightMs), base - 1);
      svg.append(s('path', { class: `bar-${hr.status}`, d: barPath(bx, top, barW, base) }));
    }
  });

  // Selection outline, moved (not rebuilt) when the hour changes.
  const sel = s('rect', { class: 'sel', y: m.t, width: slot - 1, height: ph, rx: 3 });
  const place = () => {
    const i = o.hours.findIndex((hr) => hr.time === o.selected);
    sel.setAttribute('visibility', i < 0 ? 'hidden' : 'visible');
    if (i >= 0) sel.setAttribute('x', String(x(i) + 0.5));
  };
  place();
  svg.append(sel);
  const select = (time: string) => {
    if (time === o.selected) return;
    o.selected = time;
    place();
    o.onSelect(time);
  };

  // Permitted limit: dashed line with a direct label.
  const ly = y(o.permittedMs);
  svg.append(s('line', { class: 'limit', x1: m.l, x2: width - m.r, y1: ly, y2: ly }));
  svg.append(s('text', { class: 'limit-label', x: width - m.r, y: ly - 6, 'text-anchor': 'end' }, `Permitted ${ms(o.permittedMs)}`));

  // X labels every 3 hours.
  o.hours.forEach((hr, i) => {
    if (i % 3 === 0) svg.append(s('text', { x: x(i) + slot / 2, y: height - 8, 'text-anchor': 'middle' }, hhmm(hr.time).slice(0, 2)));
  });

  // Hit targets: the full column, wider than the bar.
  o.hours.forEach((hr, i) => {
    const hit = s('rect', { class: 'hit', x: x(i), y: m.t, width: slot, height: ph + m.b });
    hit.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse') select(hr.time);
    });
    hit.addEventListener('click', () => select(hr.time));
    svg.append(hit);
  });

  svg.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    e.preventDefault();
    const idx = Math.max(0, o.hours.findIndex((hr) => hr.time === o.selected));
    const next = Math.min(o.hours.length - 1, Math.max(0, idx + (k === 'ArrowRight' ? 1 : -1)));
    select(o.hours[next].time);
  });

  return svg;
}
