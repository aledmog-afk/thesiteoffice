import { checksSections } from '../../checks/reportLines';
import { APP_NAME } from '../../config';
import { CHECK_ANEMOMETER, CHECK_OPERATOR, DECISION_LABEL, tickLabel, verifyRecord, type DecisionRecord } from '../../lift/record';
import { buildRecordPdf, pdfFilename, terrainText } from '../../pdf/recordPdf';
import { exportRecords, importRecords } from '../../storage/exchange';
import { STATUS_LABEL } from '../../wind';
import type { Ctx } from '../app';
import { clear, download, h } from '../dom';
import { card } from '../fields';
import { hhmm, instant, longDate, num, pct, speed } from '../format';
import { banner, flagCounts, loadsCard, statusPill } from './assessment';

/** Result of the last import, shown once after the list is rebuilt. */
let sessionNote = '';

async function savePdf(record: DecisionRecord, button: HTMLButtonElement): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Making PDF…';
  try {
    const doc = await buildRecordPdf(record, await verifyRecord(record));
    download(pdfFilename(record), doc.output('blob'));
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function pdfButton(record: DecisionRecord, primary = false): HTMLButtonElement {
  const b = h('button', { class: `btn ${primary ? 'primary' : ''} small`, type: 'button' }, 'PDF');
  b.addEventListener('click', () => void savePdf(record, b));
  return b;
}

export function recordsScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const body = h('div', null, h('p', { role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Loading records…'));
  const el = h('div', null, body);

  const load = async () => {
    try {
      if (state.viewingRecordId) {
        const record = await state.store.get(state.viewingRecordId);
        if (record) {
          const ok = await verifyRecord(record);
          clear(body);
          body.append(recordView(ctx, record, ok));
          return;
        }
        state.viewingRecordId = null;
      }
      const records = await state.store.list();
      clear(body);
      body.append(listView(ctx, records));
    } catch (err) {
      clear(body);
      body.append(h('div', { class: 'notice warn', role: 'alert' }, `Could not open the records on this device: ${err instanceof Error ? err.message : String(err)}`));
    }
  };
  void load();
  return el;
}

function listView(ctx: Ctx, records: DecisionRecord[]): HTMLElement {
  const { state } = ctx;
  const msg = h('p', { role: 'status', class: 'small' });

  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'import-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const result = await importRecords(state.store, await f.text());
      const parts = [`${result.added} added`, `${result.skippedExisting} already here`];
      if (result.rejected.length) parts.push(`${result.rejected.length} rejected (${result.rejected.map((r) => r.reason).join('; ')})`);
      sessionNote = `Import: ${parts.join(', ')}.`;
      ctx.rerender();
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  const note = sessionNote;
  sessionNote = '';

  return h(
    'div',
    null,
    h('h1', { tabindex: -1 }, 'Records'),
    h(
      'div',
      { class: state.storePersistent ? 'notice' : 'notice warn' },
      state.storePersistent
        ? 'Records are stored on this device only, in this browser. Clearing site data deletes them. Export them regularly.'
        : 'This browser cannot store records. They will be lost when the tab closes. Export before closing.',
    ),
    note ? h('p', { class: 'notice', role: 'status' }, note) : null,
    h(
      'div',
      { class: 'actions', style: 'margin-bottom:14px' },
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          disabled: records.length === 0,
          onclick: async () => {
            const json = await exportRecords(state.store);
            download(`${APP_NAME}-records-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }));
          },
        },
        'Export all (JSON)',
      ),
      h('label', { class: 'btn small', for: 'import-file', tabindex: 0, role: 'button', onkeydown: (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && file.click() }, 'Import JSON'),
      file,
    ),
    msg,
    records.length === 0
      ? card(h('p', { class: 'muted' }, 'No records yet. Records appear here after you save a decision.'))
      : h(
          'ul',
          { class: 'records' },
          records.map((r) =>
            h(
              'li',
              null,
              h('div', { style: 'display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center' }, h('strong', null, `${longDate(r.assessment.liftDate)}`), statusPill(r.assessment.overallStatus)),
              h('div', null, `${DECISION_LABEL[r.decision.choice]} · ${r.setup.site?.label ?? ''}`),
              h('div', { class: 'meta' }, `${r.decision.name}, ${r.decision.role} · saved ${instant(r.createdAt)}`),
              h(
                'div',
                { class: 'actions' },
                h(
                  'button',
                  {
                    class: 'btn small',
                    type: 'button',
                    onclick: () => {
                      state.viewingRecordId = r.id;
                      ctx.go('records');
                    },
                  },
                  'View',
                ),
                pdfButton(r),
              ),
            ),
          ),
        ),
  );
}


function recordView(ctx: Ctx, r: DecisionRecord, integrityOk: boolean): HTMLElement {
  const a = r.assessment;
  const s = r.setup;
  const d = r.decision;
  const w = a.worst;
  const kv = (rows: [string, string][]) => h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v || '–')]));
  const flags = flagCounts(a.windowHours);

  return h(
    'div',
    null,
    h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        onclick: () => {
          ctx.state.viewingRecordId = null;
          ctx.go('records');
        },
      },
      '← All records',
    ),
    h('h1', { tabindex: -1, style: 'margin-top:12px' }, 'Decision record'),
    h('p', { class: 'lede' }, `Saved ${instant(r.createdAt)} · read-only · method ${r.methodVersion}`),
    integrityOk ? null : h('div', { class: 'notice warn', role: 'alert' }, 'This record does not match its integrity hash. It may have been altered after saving.'),
    banner(a.overallStatus),
    h('div', { class: 'actions', style: 'margin:-4px 0 14px' }, pdfButton(r, true)),
    card(
      h('h2', null, 'Decision'),
      kv([
        ['Decision', DECISION_LABEL[d.choice]],
        ['Name', d.name],
        ['Role', d.role],
        ['Notes', d.notes],
        ['Anemometer check', `${tickLabel(d.anemometerChecked, d.choice)}: ${CHECK_ANEMOMETER}`],
        ['Operator decision', `${tickLabel(d.operatorRetainsDecision, d.choice)}: ${CHECK_OPERATOR}`],
      ]),
    ),
    card(
      h('h2', null, 'Lift'),
      kv([
        ['Site', s.site ? `${s.site.label} (${s.site.latitude.toFixed(4)}, ${s.site.longitude.toFixed(4)})` : ''],
        ['Lift date', longDate(a.liftDate)],
        ['Window', `${hhmm(a.windowStart)}–${hhmm(a.windowEnd)}${a.windowDefaulted ? ' (sunrise to sunset)' : ' (planned)'}`],
        ['Crane', s.craneDescription],
        ['Chart limit', `${speed(s.chartLimitMs)} (${s.chartLimitType})`],
        ['Limit source', s.chartLimitSource],
        ['Boom / jib head height', `${s.heightM} m`],
        ['Terrain', terrainText(s.terrain)],
        ['Load', `${s.loadDescription || 'Flat load'}: ${s.loadLengthM} × ${s.loadHeightM} m, ${s.loadMassKg} kg + ${s.riggingMassKg} kg rigging, hook block and rope, cw ${s.dragCoefficient}`],
      ]),
    ),
    card(
      h('h2', null, 'Calculation'),
      kv([
        ...a.load.steps.map((st): [string, string] => [st.label, `${st.formula} = ${num(st.value, st.unit === 'm/s' ? 2 : 3)} ${st.unit}`]),
        ['Gust factor', `${num(a.heightFactor, 3)} at ${a.heightM} m, ${terrainText(s.terrain).toLowerCase()}`],
        ['Worst hour', w ? `${hhmm(w.time)}: ${speed(w.gustAtHeightMs)} at height, ${pct(w.percentOfLimit, w.status)} of permitted (${STATUS_LABEL[w.status]})` : ''],
        ['Flags in window', flags.map((f) => `${f.label} (${f.hours} h)`).join(', ') || 'None'],
      ]),
    ),
    a.loads && a.loads.length > 1 ? loadsCard(a) : null,
    card(
      h('h2', null, 'Forecast used'),
      kv([
        ['Source', `${r.forecast.source} (${r.forecast.endpoint})`],
        ['Model', r.forecast.model],
        ['Fetched', instant(r.forecast.fetchedAt)],
        ['Grid point', `${r.forecast.gridLatitude.toFixed(3)}, ${r.forecast.gridLongitude.toFixed(3)}`],
        ['Hours stored', `${a.liftDayForecast.length} hourly values for ${a.liftDate}`],
      ]),
    ),
    r.checks
      ? card(
          h('h2', null, 'Checks'),
          checksSections(r.checks).map((sec) => [h('h3', { style: 'margin-top:12px' }, sec.title), kv(sec.rows)]),
        )
      : null,
    card(h('h2', null, 'Integrity'), h('p', { class: 'small', style: 'overflow-wrap:anywhere' }, `SHA-256 ${r.integrity}`), h('p', { class: 'small muted' }, integrityOk ? 'Content matches the hash.' : 'Content does NOT match the hash.')),
  );
}
