import type { DecisionRecord } from '../../lift/record';
import {
  allUnits,
  compareWithForecast,
  DEFAULT_WAIT_MINUTES,
  evaluateLog,
  fromMs,
  newLogEntry,
  STATE_LABEL,
  toMs,
  UNIT_LABEL,
  type LogEntry,
  type LogState,
  type SpeedUnit,
} from '../../windlog/log';
import type { Ctx } from '../app';
import { clear, h, readNumber, safeStorage } from '../dom';
import { card } from '../fields';
import { longDate } from '../format';

const UNIT_KEY = 'liftwatch.windlog.unit';
const WAIT_KEY = 'liftwatch.windlog.wait';
const BY_KEY = 'liftwatch.windlog.by';

const TONE: Record<LogState, string> = {
  'no-readings': 'st-no-data',
  within: 'st-within',
  near: 'st-near',
  stopped: 'st-over',
  waiting: 'st-near',
  waited: 'st-no-data',
  'wound-off': 'st-no-data',
};
const ICON: Record<LogState, string> = { 'no-readings': '?', within: '✓', near: '!', stopped: '✕', waiting: '⏱', waited: '⏱', 'wound-off': '■' };

function time(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Lift-day wind log for a saved record (CPA/TCIG 2507 section 6.4.3). */
export function windLogView(ctx: Ctx, record: DecisionRecord, back: () => void): HTMLElement {
  const a = record.assessment;
  const limit = a.load.permittedMs;
  let unit = (safeStorage.get(UNIT_KEY) as SpeedUnit | null) ?? 'ms';
  let wait = Number(safeStorage.get(WAIT_KEY)) || DEFAULT_WAIT_MINUTES;
  let entries: LogEntry[] = [];

  const statusBox = h('div', { 'aria-live': 'polite' });
  const loadsBox = h('div');
  const listBox = h('div');
  const msg = h('p', { role: 'status', class: 'small' });

  function render(): void {
    const ev = evaluateLog(entries, limit, wait, new Date());
    clear(statusBox);
    statusBox.append(
      h(
        'div',
        { class: `banner ${TONE[ev.state]}` },
        h('span', { class: 'icon', 'aria-hidden': 'true' }, ICON[ev.state]),
        h('div', null, h('div', { class: 'label', style: 'font-size:1.25rem' }, ev.headline), h('div', { class: 'sub' }, ev.detail)),
      ),
    );

    clear(loadsBox);
    if (a.loads && a.loads.length > 1 && ev.lastReading?.gustMs !== undefined) {
      const g = ev.lastReading.gustMs;
      loadsBox.append(
        card(
          h('h2', null, 'Loads at the last reading'),
          h('p', { class: 'small muted' }, `Last reading ${fromMs(g, unit).toFixed(unit === 'ms' ? 1 : 0)} ${UNIT_LABEL[unit]} at ${time(ev.lastReading.at)}. Loads whose own limit is above it:`),
          h(
            'ul',
            { class: 'periods' },
            [...a.loads]
              .sort((x, y) => x.result.permittedMs - y.result.permittedMs)
              .map((l) =>
                h(
                  'li',
                  null,
                  `${g <= l.result.permittedMs ? '✓' : '✕'} ${l.ref}: limit ${fromMs(l.result.permittedMs, unit).toFixed(unit === 'ms' ? 1 : 0)} ${UNIT_LABEL[unit]}`,
                ),
              ),
          ),
          h('p', { class: 'small muted' }, 'The stop / wait above follows the governing (most wind-sensitive) load.'),
        ),
      );
    }

    const cmp = compareWithForecast(entries, a.liftDayHours);
    const fcst = new Map(cmp.pairs.map((p) => [p.entry.id, p.forecastMs]));
    clear(listBox);
    if (ev.timeline.length === 0) {
      listBox.append(h('p', { class: 'muted small' }, 'Nothing logged yet.'));
      return;
    }
    listBox.append(
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Reading'), h('th', null, 'm/s'), h('th', null, 'Forecast'), h('th', { class: 'l' }, 'After'), h('th', { class: 'l' }, 'Note / by'))),
          h(
            'tbody',
            null,
            [...ev.timeline].reverse().map(({ entry, state }) =>
              h(
                'tr',
                null,
                h('td', null, time(entry.at)),
                h('td', null, entry.kind === 'reading' ? `${entry.value} ${UNIT_LABEL[entry.unit ?? 'ms']}` : entry.kind === 'wind-off' ? 'Wind off' : 'Note'),
                h('td', null, entry.gustMs !== undefined ? entry.gustMs.toFixed(1) : '–'),
                h('td', null, fcst.has(entry.id) ? fcst.get(entry.id)!.toFixed(1) : '–'),
                h('td', { class: 'l' }, STATE_LABEL[state]),
                h('td', { class: 'l', style: 'white-space:normal' }, [entry.note, entry.by].filter(Boolean).join(' · ') || '–'),
              ),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'small muted' },
        cmp.meanRatio === null
          ? 'Forecast: the forecast gust at height for the same hour, in m/s.'
          : `Forecast vs measured: over ${cmp.pairs.length} reading${cmp.pairs.length === 1 ? '' : 's'}, the anemometer read on average ${Math.round(cmp.meanRatio * 100)} % of the forecast gust at height. Over a pilot this shows whether the forecast runs high or low here (CPA 5.2.2). It does not change any status.`,
      ),
    );
  }

  async function load(): Promise<void> {
    entries = await ctx.state.store.listLog(record.id);
    render();
  }

  async function add(entry: LogEntry): Promise<void> {
    try {
      await ctx.state.store.addLogEntry(entry);
      entries.push(entry);
      render();
    } catch (err) {
      msg.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ---------- Inputs ----------
  const value = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Gust reading', 'aria-label': 'Anemometer gust reading', class: 'big-input' });
  const unitSel = h('select', { 'aria-label': 'Unit' }, (Object.keys(UNIT_LABEL) as SpeedUnit[]).map((u) => h('option', { value: u, selected: u === unit }, UNIT_LABEL[u])));
  unitSel.addEventListener('change', () => {
    unit = unitSel.value as SpeedUnit;
    safeStorage.set(UNIT_KEY, unit);
    limitLine.textContent = limitText();
    render();
  });
  const by = h('input', { type: 'text', placeholder: 'Your name (optional)', value: safeStorage.get(BY_KEY) ?? '', 'aria-label': 'Logged by' });
  by.addEventListener('input', () => safeStorage.set(BY_KEY, by.value));
  const logBtn = h('button', { type: 'button', class: 'btn primary' }, 'Log reading');
  logBtn.addEventListener('click', () => {
    const v = readNumber(value);
    if (v === null || !Number.isFinite(v) || v < 0) {
      msg.textContent = 'Enter the gust reading as a number.';
      value.focus();
      return;
    }
    msg.textContent = '';
    void add(newLogEntry(record.id, 'reading', { value: v, unit, gustMs: toMs(v, unit), by: by.value.trim() || undefined }));
    value.value = '';
  });
  value.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') logBtn.click();
  });

  const note = h('input', { type: 'text', placeholder: 'e.g. gusting from the west, load swinging', 'aria-label': 'Note' });
  const noteBtn = h('button', { type: 'button', class: 'btn small' }, 'Add note');
  noteBtn.addEventListener('click', () => {
    if (!note.value.trim()) return;
    void add(newLogEntry(record.id, 'note', { note: note.value.trim(), by: by.value.trim() || undefined }));
    note.value = '';
  });
  const windOff = h('button', { type: 'button', class: 'btn small' }, 'Wind off for the day');
  windOff.addEventListener('click', () => {
    if (!confirm('Log that lifting is winded off for the day?')) return;
    void add(newLogEntry(record.id, 'wind-off', { note: note.value.trim() || undefined, by: by.value.trim() || undefined }));
    note.value = '';
  });

  const waitSel = h(
    'select',
    { 'aria-label': 'Wait after the wind drops' },
    [
      [30, '30 minutes (CPA 6.4.3, common practice)'],
      [20, '20 minutes'],
      [10, '10 minutes (BS 7121-5, tower cranes)'],
    ].map(([m, label]) => h('option', { value: String(m), selected: m === wait }, String(label))),
  );
  waitSel.addEventListener('change', () => {
    wait = Number(waitSel.value);
    safeStorage.set(WAIT_KEY, String(wait));
    render();
  });

  const limitText = () => `Permitted for ${a.loads && a.loads.length > 1 ? `the governing load (${a.governingRef})` : 'this load'}: ${allUnits(limit)}`;
  const limitLine = h('p', { class: 'limit-line' }, limitText());

  const el = h(
    'div',
    null,
    h('button', { class: 'btn small', type: 'button', onclick: back }, '← Record'),
    h('h1', { tabindex: -1, style: 'margin-top:12px' }, 'Wind log'),
    h('p', { class: 'lede' }, `${longDate(a.liftDate)} · ${record.setup.site?.label ?? ''}. Log the crane anemometer’s gust reading at the boom / jib head.`),
    limitLine,
    statusBox,
    card(
      h('h2', null, 'New reading'),
      h('div', { class: 'inline' }, value, unitSel),
      h('div', { class: 'actions' }, logBtn),
      msg,
      h('div', { class: 'field', style: 'margin-top:12px' }, h('label', null, 'Logged by'), by),
    ),
    loadsBox,
    card(h('h2', null, 'Log'), listBox),
    card(
      h('h2', null, 'Notes and settings'),
      h('div', { class: 'inline' }, note, noteBtn),
      h('div', { class: 'field', style: 'margin-top:12px' }, h('label', null, 'Wait after the wind drops below the limit'), waitSel),
      h('div', { class: 'actions' }, windOff),
      h('p', { class: 'small muted' }, 'Entries cannot be edited or deleted. The crane operator has the final decision to lift, continue or stop (CPA 6.4).'),
    ),
  );

  void load();
  // Keep the waiting time current while the log is on screen.
  const timer = setInterval(() => {
    if (!el.isConnected) clearInterval(timer);
    else render();
  }, 20000);
  return el;
}
