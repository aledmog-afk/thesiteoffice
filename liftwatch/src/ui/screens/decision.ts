import { NO_ITEMS_FLAGGED } from '../../checks/reportLines';
import { buildChecksReport } from '../../checks/model';
import { DISCLAIMER } from '../../config';
import {
  CHECK_ANEMOMETER,
  CHECK_OPERATOR,
  createRecord,
  DECISION_LABEL,
  DECISION_OWNERSHIP,
  newDecisionDraft,
  ROLE_HINT,
  validateDecision,
  type Decision,
  type DecisionChoice,
} from '../../lift/record';
import type { Ctx } from '../app';
import { h, safeStorage } from '../dom';
import { card, field, textInput, type FieldHandle } from '../fields';
import { hourLabel, longDate, pct, speed } from '../format';
import { saveChecks } from '../state';
import { banner } from './assessment';

const PERSON_KEY = 'liftwatch.person.v1';

function freshDraft(): Decision {
  try {
    return newDecisionDraft(JSON.parse(safeStorage.get(PERSON_KEY) ?? '{}'));
  } catch {
    return newDecisionDraft();
  }
}

let draft: Decision | null = null;

const CHOICES: { value: DecisionChoice; desc: string }[] = [
  { value: 'proceed', desc: 'Lift as planned, subject to on-site checks' },
  { value: 'postpone', desc: 'Do not lift in this window' },
  { value: 'proceed-with-conditions', desc: 'Lift only under the conditions written below' },
];

function checksSummary(ctx: Ctx): HTMLElement {
  const r = buildChecksReport(ctx.state.checks, ctx.state.setup.liftDate);
  return card(
    h('h2', null, 'Checks'),
    h(
      'p',
      null,
      r.attention.length ? `${r.attention.length} item${r.attention.length === 1 ? ' needs' : 's need'} attention` : NO_ITEMS_FLAGGED,
      ` · ${r.incomplete.length} not done · ${ctx.state.checks.crew.length} signed on.`,
    ),
    r.attention.length ? h('ul', { class: 'attention-list' }, r.attention.map((x) => h('li', null, x))) : h('span'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => ctx.go('checks') }, 'Open checks')),
  );
}

export function decisionScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const title = h('h1', { tabindex: -1 }, 'Record decision');
  const a = state.assessment;
  if (!a || !state.forecast) {
    return h(
      'div',
      null,
      title,
      card(
        h('p', null, 'Run the assessment first. The record holds the assessment it was based on.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('assessment') }, '← Assessment'),
      ),
    );
  }

  const d = (draft ??= freshDraft());
  let showErrors = false;
  const handles: Partial<Record<keyof Decision, FieldHandle>> = {};
  const refresh = () => {
    const e = validateDecision(d);
    for (const [k, hd] of Object.entries(handles) as [keyof Decision, FieldHandle][]) hd.setError(showErrors ? e[k] : undefined);
  };

  const choiceGroup = h('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'dc-label' });
  for (const c of CHOICES) {
    const radio = h('input', { type: 'radio', name: 'decision', value: c.value, checked: d.choice === c.value });
    radio.addEventListener('change', () => {
      d.choice = c.value;
      refresh();
    });
    choiceGroup.append(h('label', { class: 'choice' }, radio, h('span', null, h('span', { class: 't' }, DECISION_LABEL[c.value]), h('span', { class: 'd' }, c.desc))));
  }

  const name = textInput(d.name, (v) => ((d.name = v), refresh()), { autocomplete: 'name' });
  const role = textInput(d.role, (v) => ((d.role = v), refresh()), { autocomplete: 'organization-title' });
  const notes = h('textarea', { rows: 4, placeholder: 'Conditions, observations, on-site anemometer readings…' });
  notes.value = d.notes;
  notes.addEventListener('input', () => ((d.notes = notes.value), refresh()));

  const tick = (key: 'anemometerChecked' | 'operatorRetainsDecision', text: string) => {
    const box = h('input', { type: 'checkbox', checked: d[key] });
    box.addEventListener('change', () => ((d[key] = box.checked), refresh()));
    const err = h('div', { class: 'error', role: 'alert', hidden: true });
    handles[key] = {
      el: box,
      setError(m) {
        err.hidden = !m;
        err.textContent = m ?? '';
      },
    };
    return h('div', { class: 'field' }, h('label', { class: 'check' }, box, h('span', null, text)), err);
  };

  const nameF = field('Your name', name);
  const roleF = field('Role', role, ROLE_HINT);
  const notesF = field('Notes and conditions', notes, 'Required if your decision is to proceed with conditions');
  handles.name = nameF;
  handles.role = roleF;
  handles.notes = notesF;

  const status = h('p', { role: 'status' });
  const save = h('button', { class: 'btn primary block', type: 'button' }, 'Save record');
  save.addEventListener('click', async () => {
    showErrors = true;
    refresh();
    if (Object.keys(validateDecision(d)).length) {
      status.textContent = 'Check the highlighted items.';
      return;
    }
    save.disabled = true;
    try {
      const record = await createRecord(state.setup, state.forecast!, a, d, new Date(), crypto.randomUUID(), buildChecksReport(state.checks, a.liftDate));
      await state.store.add(record);
      safeStorage.set(PERSON_KEY, JSON.stringify({ name: d.name }));
      draft = null;
      // Answers and sign-ons belong to this lift. Dates, cards and calculations carry over.
      state.checks.answers = {};
      state.checks.crew = [];
      saveChecks(state.checks);
      state.viewingRecordId = record.id;
      ctx.go('records');
    } catch (err) {
      save.disabled = false;
      status.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  const w = a.worst;
  const el = h(
    'div',
    null,
    title,
    h('p', { class: 'lede' }, `${longDate(a.liftDate)} · ${state.setup.site!.label}`),
    banner(a.overallStatus, a.worst?.percentOfLimit),
    card(
      h('p', null, `Worst hour ${w ? hourLabel(w) : '–'}: gust at height ${speed(w?.gustAtHeightMs)} against a permitted ${speed(a.load.permittedMs)} (${pct(w?.percentOfLimit, w?.status)}).`),
      h('p', { class: 'small muted' }, 'Saving stores every input, the full calculation, the forecast values used, the forecast fetch time and the method version, as a timestamped record with an integrity check that detects accidental changes. There is no edit button: to change a decision, save a new record.'),
    ),
    checksSummary(ctx),
    card(h('h2', { id: 'dc-label' }, 'Your decision'), h('p', { class: 'small muted' }, DECISION_OWNERSHIP), choiceGroup),
    card(nameF.el, roleF.el, notesF.el),
    card(h('h2', null, 'Confirm'), tick('anemometerChecked', CHECK_ANEMOMETER), tick('operatorRetainsDecision', CHECK_OPERATOR), h('p', { class: 'small muted' }, 'Both are required to record a decision to proceed.')),
    save,
    status,
    h('p', { class: 'disclaimer' }, DISCLAIMER),
  );
  refresh();
  return el;
}
