import { ALL_ITEMS_DONE, NO_ITEMS_FLAGGED } from '../../checks/reportLines';
import { CAPACITY_HIGH_UTILISATION, CAPACITY_REVIEW_UTILISATION, capacityCheck, type CapacityInput } from '../../checks/capacity';
import { bearingCheck } from '../../checks/bearing';
import { ACCESSORY_EXAM_MONTHS, CRANE_EXAM_MONTHS, examStatus, expiryStatus, type ExamStatus } from '../../checks/certificates';
import { buildChecksReport, CHECKLIST, type Answer, type LabelledBearing, type LabelledSling } from '../../checks/model';
import { slingCheck, type SlingLegs } from '../../checks/slings';
import { CALCULATORS_UNAVAILABLE, FEATURES } from '../../config';
import type { Ctx } from '../app';
import { clear, h, readNumber } from '../dom';
import { card } from '../fields';
import { longDate } from '../format';
import { saveChecks } from '../state';

type Tone = 'ok' | 'attention' | 'incomplete';

function chip(tone: Tone, text: string): HTMLElement {
  const cls = tone === 'ok' ? 'neutral' : tone === 'attention' ? 'st-over' : 'st-no-data';
  const icon = tone === 'ok' ? '' : tone === 'attention' ? '✕' : '…';
  return h('span', { class: `pill ${cls}` }, h('span', { 'aria-hidden': 'true' }, icon), text);
}

/** In place of a calculator that is switched off (`FEATURES.calculators`). */
function unavailable(title: string): HTMLElement {
  return card(h('h2', null, title), h('p', { class: 'check-result unavailable', role: 'note' }, CALCULATORS_UNAVAILABLE));
}

function statusLine(s: ExamStatus): HTMLElement {
  const tone: Tone = s.status === 'ok' ? 'ok' : s.status === 'missing' ? 'incomplete' : 'attention';
  return h('div', { class: `check-result tone-${tone}` }, s.message);
}

/** A number box that writes straight into an object field. */
function numBox(obj: Record<string, unknown>, key: string, label: string, onChange: () => void, placeholder = ''): HTMLElement {
  const v = obj[key] as number | null;
  const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, value: v === null || v === undefined || Number.isNaN(v) ? '' : String(v) });
  input.addEventListener('input', () => {
    obj[key] = readNumber(input);
    onChange();
  });
  return h('label', { class: 'mini' }, h('span', null, label), input);
}

function textBox(obj: Record<string, unknown>, key: string, label: string, onChange: () => void, placeholder = ''): HTMLElement {
  const input = h('input', { type: 'text', placeholder, value: (obj[key] as string) ?? '' });
  input.addEventListener('input', () => {
    obj[key] = input.value;
    onChange();
  });
  return h('label', { class: 'mini wide' }, h('span', null, label), input);
}

function dateBox(value: string | null, label: string, onValue: (v: string | null) => void): HTMLElement {
  const input = h('input', { type: 'date', value: value ?? '' });
  input.addEventListener('input', () => onValue(input.value || null));
  return h('label', { class: 'mini' }, h('span', null, label), input);
}

/**
 * A list of calculation rows. Each row is built once; only its result line is
 * rewritten as the user types, so the keyboard does not jump.
 */
function rowList<T>(items: T[], opts: {
  empty: string;
  addLabel: string;
  make: () => T;
  fields: (item: T, onChange: () => void) => HTMLElement[];
  result: (item: T) => { tone: Tone; text: string };
  onChange: () => void;
}): HTMLElement {
  const list = h('div');
  const render = () => {
    clear(list);
    if (items.length === 0) list.append(h('p', { class: 'small muted' }, opts.empty));
    items.forEach((item, i) => {
      const out = h('div', { class: 'check-result', 'aria-live': 'polite' });
      const show = () => {
        const r = opts.result(item);
        out.className = `check-result tone-${r.tone}`;
        out.textContent = r.text;
      };
      const changed = () => {
        show();
        opts.onChange();
      };
      const remove = h('button', { type: 'button', class: 'btn small' }, 'Remove');
      remove.addEventListener('click', () => {
        items.splice(i, 1);
        render();
        opts.onChange();
      });
      show();
      list.append(h('div', { class: 'load-row' }, h('div', { class: 'mini-grid' }, opts.fields(item, changed)), out, h('div', { class: 'actions' }, remove)));
    });
  };
  const add = h('button', { type: 'button', class: 'btn small' }, opts.addLabel);
  add.addEventListener('click', () => {
    items.push(opts.make());
    render();
    opts.onChange();
  });
  render();
  return h('div', null, list, h('div', { class: 'actions' }, add));
}

export function checksScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const c = state.checks;
  const liftDate = state.setup.liftDate;
  const summaryBox = h('div', { 'aria-live': 'polite' });

  const changed = () => {
    saveChecks(c);
    renderSummary();
  };

  function renderSummary(): void {
    const r = buildChecksReport(c, liftDate);
    clear(summaryBox);
    summaryBox.append(
      h(
        'div',
        { class: 'actions', style: 'margin:0 0 8px' },
        r.attention.length ? chip('attention', `${r.attention.length} need attention`) : chip('ok', NO_ITEMS_FLAGGED),
        r.incomplete.length ? chip('incomplete', `${r.incomplete.length} not done`) : chip('ok', ALL_ITEMS_DONE),
      ),
    );
    if (r.attention.length) summaryBox.append(h('ul', { class: 'attention-list' }, r.attention.map((a) => h('li', null, a))));
  }

  // ---------- Examinations and cards ----------
  const craneOut = h('div');
  const accOut = h('div');
  const showExams = () => {
    clear(craneOut);
    craneOut.append(statusLine(examStatus(c.craneExamDate, liftDate, CRANE_EXAM_MONTHS)));
    clear(accOut);
    accOut.append(statusLine(examStatus(c.accessoriesExamDate, liftDate, ACCESSORY_EXAM_MONTHS)));
  };
  showExams();
  const exams = card(
    h('h2', null, 'Thorough examinations'),
    h('p', { class: 'small muted' }, `LOLER regulation 9: crane at least every ${CRANE_EXAM_MONTHS} months, lifting accessories every ${ACCESSORY_EXAM_MONTHS} months, unless a written scheme says otherwise. Checked against the lift date, ${longDate(liftDate)}.`),
    dateBox(c.craneExamDate, 'Crane: date of last thorough examination', (v) => {
      c.craneExamDate = v;
      showExams();
      changed();
    }),
    craneOut,
    h('div', { style: 'height:10px' }),
    dateBox(c.accessoriesExamDate, 'Slings and accessories: oldest examination date', (v) => {
      c.accessoriesExamDate = v;
      showExams();
      changed();
    }),
    accOut,
  );

  const cards = card(
    h('h2', null, 'Competence cards'),
    h('p', { class: 'small muted' }, 'Card scheme and number, e.g. CPCS or NPORS, and the expiry date.'),
    c.cards.map((cc) => {
      const out = h('div');
      const show = () => {
        clear(out);
        out.append(statusLine(expiryStatus(cc.expiry, liftDate)));
      };
      show();
      const on = () => {
        show();
        changed();
      };
      return h(
        'div',
        { class: 'load-row' },
        h('strong', null, cc.role),
        h(
          'div',
          { class: 'mini-grid' },
          textBox(cc as unknown as Record<string, unknown>, 'holder', 'Name', on),
          textBox(cc as unknown as Record<string, unknown>, 'card', 'Card scheme and number', on),
          dateBox(cc.expiry, 'Expiry', (v) => {
            cc.expiry = v;
            on();
          }),
        ),
        out,
      );
    }),
  );

  // ---------- Checklist ----------
  const checklist = card(
    h('h2', null, 'Pre-lift checklist'),
    h('ol', { class: 'checklist' }, CHECKLIST.map((item) => {
      const group = h('div', { class: 'yn', role: 'radiogroup', 'aria-label': item.text });
      const choices: [Answer, string][] = [['yes', 'Yes'], ['no', 'No'], ['na', 'N/A']];
      for (const [val, label] of choices) {
        const radio = h('input', { type: 'radio', name: `ck-${item.id}`, value: String(val), checked: c.answers[item.id] === val });
        radio.addEventListener('change', () => {
          c.answers[item.id] = val;
          changed();
        });
        group.append(h('label', { class: `yn-${val}` }, radio, h('span', null, label)));
      }
      return h('li', null, h('div', { class: 't' }, item.text), h('div', { class: 'small muted' }, item.why), group);
    })),
  );

  // ---------- Capacity ----------
  const s = state.setup;
  const capacity = !FEATURES.calculators ? unavailable('Crane capacity') : card(
    h('h2', null, 'Crane capacity'),
    h(
      'p',
      { class: 'small muted' },
      `Total hook load against the rated capacity from the load chart for this configuration and radius. Include accessories, and the hook block and rope if the chart does not deduct them. Bands: above ${CAPACITY_REVIEW_UTILISATION * 100} % justify in the plan, above ${CAPACITY_HIGH_UTILISATION * 100} % high (company rules, set in config).`,
    ),
    rowList<CapacityInput>(c.capacity, {
      empty: 'No capacity checks yet. Add one for the heaviest load and one for the furthest radius.',
      addLabel: '+ Add a capacity check',
      make: () => ({ label: s.loadDescription || 'Main load', radiusM: null, chartCapacityKg: null, loadKg: s.loadMassKg, accessoriesKg: s.riggingMassKg, hookBlockKg: null }),
      fields: (x, on) => {
        const o = x as unknown as Record<string, unknown>;
        return [
          textBox(o, 'label', 'Lift', on, 'e.g. W12 to plot 4'),
          numBox(o, 'radiusM', 'Radius m', on),
          numBox(o, 'chartCapacityKg', 'Chart capacity kg', on),
          numBox(o, 'loadKg', 'Load kg', on),
          numBox(o, 'accessoriesKg', 'Accessories kg', on),
          numBox(o, 'hookBlockKg', 'Hook block + rope kg', on),
        ];
      },
      result: (x) => {
        const r = capacityCheck(x);
        return { tone: r.band === 'ok' ? 'ok' : r.band === 'incomplete' ? 'incomplete' : 'attention', text: r.band === 'incomplete' ? r.message : `Hook load ${Math.round(r.totalKg)} kg: ${r.message}` };
      },
      onChange: changed,
    }),
  );

  // ---------- Slings ----------
  const slings = !FEATURES.calculators ? unavailable('Slings') : card(
    h('h2', null, 'Slings'),
    h('p', { class: 'small muted' }, 'Uniform load method (BS EN 818-4, 13414-1, 1492-1; LEEA). Leg angle from the leg length and the distance between lifting points: for 4 legs use the diagonal. Mode factor 2 legs 1.4 up to 45°, 1.0 to 60°; 3–4 legs 2.1 and 1.5; over 60° not permitted.'),
    rowList<LabelledSling>(c.slings, {
      empty: 'No sling checks yet.',
      addLabel: '+ Add a sling check',
      make: () => ({ label: '2-leg chain', legs: 2, legLengthM: null, spreadM: null, loadKg: s.loadMassKg, singleLegWllKg: null }),
      fields: (x, on) => {
        const o = x as unknown as Record<string, unknown>;
        const legs = h('select', null, [1, 2, 3, 4].map((n) => h('option', { value: String(n), selected: x.legs === n }, `${n} leg${n > 1 ? 's' : ''}`)));
        legs.addEventListener('change', () => {
          x.legs = Number(legs.value) as SlingLegs;
          on();
        });
        return [
          textBox(o, 'label', 'Sling', on),
          h('label', { class: 'mini' }, h('span', null, 'Legs'), legs),
          numBox(o, 'legLengthM', 'Leg length m', on),
          numBox(o, 'spreadM', 'Between lifting points m', on),
          numBox(o, 'loadKg', 'Load kg', on),
          numBox(o, 'singleLegWllKg', 'Single-leg WLL kg', on, 'optional'),
        ];
      },
      result: (x) => {
        const r = slingCheck(x);
        return { tone: r.incomplete ? 'incomplete' : r.ok ? 'ok' : 'attention', text: r.message };
      },
      onChange: changed,
    }),
  );

  // ---------- Ground bearing ----------
  const bearing = !FEATURES.calculators ? unavailable('Outrigger ground bearing') : card(
    h('h2', null, 'Outrigger ground bearing'),
    h('p', { class: 'small muted' }, 'Pressure under the mat = (outrigger load + mat weight) ÷ mat area. The outrigger load comes from the crane manufacturer’s planning software; the allowable pressure from the ground assessment or temporary works designer. Assumes a stiff mat that spreads the load evenly.'),
    rowList<LabelledBearing>(c.bearing, {
      empty: 'No ground bearing checks yet. Add one for the most heavily loaded outrigger.',
      addLabel: '+ Add an outrigger check',
      make: () => ({ label: 'Worst outrigger', outriggerLoad: null, outriggerUnit: 't', matLengthM: null, matWidthM: null, matMassKg: null, allowableKpa: null }),
      fields: (x, on) => {
        const o = x as unknown as Record<string, unknown>;
        const unit = h('select', null, h('option', { value: 't', selected: x.outriggerUnit === 't' }, 'tonnes'), h('option', { value: 'kN', selected: x.outriggerUnit === 'kN' }, 'kN'));
        unit.addEventListener('change', () => {
          x.outriggerUnit = unit.value as 't' | 'kN';
          on();
        });
        return [
          textBox(o, 'label', 'Outrigger', on),
          numBox(o, 'outriggerLoad', 'Outrigger load', on),
          h('label', { class: 'mini' }, h('span', null, 'Unit'), unit),
          numBox(o, 'matLengthM', 'Mat length m', on),
          numBox(o, 'matWidthM', 'Mat width m', on),
          numBox(o, 'matMassKg', 'Mat mass kg', on, 'optional'),
          numBox(o, 'allowableKpa', 'Allowable kN/m²', on),
        ];
      },
      result: (x) => {
        const r = bearingCheck(x);
        return { tone: r.incomplete ? 'incomplete' : r.ok ? 'ok' : 'attention', text: r.message };
      },
      onChange: changed,
    }),
  );

  // ---------- Crew sign-on ----------
  const crewList = h('ul', { class: 'crew' });
  const renderCrew = () => {
    clear(crewList);
    if (c.crew.length === 0) crewList.append(h('li', { class: 'muted small' }, 'Nobody signed on yet.'));
    c.crew.forEach((m, i) => {
      const remove = h('button', { type: 'button', class: 'btn small', 'aria-label': `Remove ${m.name}` }, 'Remove');
      remove.addEventListener('click', () => {
        c.crew.splice(i, 1);
        renderCrew();
        changed();
      });
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(m.signedAt));
      crewList.append(h('li', null, h('span', null, h('strong', null, m.name), ` · ${m.role} · ${time}`), remove));
    });
  };
  renderCrew();
  const crewName = h('input', { type: 'text', placeholder: 'Name', autocomplete: 'off' });
  const crewRole = h('select', null, ['Crane operator', 'Slinger / signaller', 'Lift supervisor', 'Appointed person', 'Crane supervisor', 'Other'].map((r) => h('option', { value: r }, r)));
  const signOn = h('button', { type: 'button', class: 'btn primary' }, 'Sign on');
  signOn.addEventListener('click', () => {
    if (!crewName.value.trim()) {
      crewName.focus();
      return;
    }
    c.crew.push({ name: crewName.value.trim(), role: crewRole.value, signedAt: new Date().toISOString() });
    crewName.value = '';
    renderCrew();
    changed();
    crewName.focus();
  });
  const crew = card(
    h('h2', null, 'Crew briefing sign-on'),
    h('p', { class: 'small muted' }, 'After the briefing, pass the phone round: each person adds their name. The time is recorded.'),
    crewList,
    h('div', { class: 'mini-grid', style: 'margin-top:10px' }, h('label', { class: 'mini wide' }, h('span', null, 'Name'), crewName), h('label', { class: 'mini' }, h('span', null, 'Role'), crewRole)),
    h('div', { class: 'actions' }, signOn),
  );

  renderSummary();
  return h(
    'div',
    null,
    h('h1', { tabindex: -1 }, 'Checks'),
    h('p', { class: 'lede' }, 'The checks reviewers most often find missing. Everything here is saved with the decision record. Nothing here blocks a decision: the AP decides.'),
    card(h('h2', null, 'Summary'), summaryBox),
    exams,
    cards,
    checklist,
    capacity,
    slings,
    bearing,
    crew,
    h('button', { class: 'btn primary block', type: 'button', onclick: () => ctx.go('decision') }, 'Record decision →'),
  );
}
