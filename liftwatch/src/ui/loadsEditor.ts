import { newScheduleLoad, parseLoadSchedule, validateScheduleLoad, type ScheduleLoad } from '../lift/loads';
import type { LiftSetup } from '../lift/setup';
import { permittedWindSpeed } from '../wind';
import { clear, h, readNumber } from './dom';
import { speed } from './format';

/**
 * Editor for the other loads in the lift plan. Rows are built once and only the
 * live result line changes as you type, so the keyboard stays where it is.
 */
export function loadsEditor(setup: LiftSetup, changed: () => void): HTMLElement {
  const list = h('div', { class: 'loads-list' });
  const pasteMsg = h('div', { role: 'status', class: 'small' });

  const defaults = () => ({ dragCoefficient: setup.dragCoefficient ?? 1.2, riggingMassKg: setup.riggingMassKg ?? 0 });

  function resultText(l: ScheduleLoad): string {
    const problem = validateScheduleLoad(l);
    if (problem) return problem.replace(`${l.ref}: `, '');
    if (!setup.chartLimitMs || setup.chartLimitMs <= 0) return 'Enter the crane chart limit to see the permitted speed.';
    try {
      const r = permittedWindSpeed({
        loadLengthM: l.lengthM,
        loadHeightM: l.heightM,
        dragCoefficient: l.dragCoefficient,
        loadMassKg: l.massKg,
        riggingMassKg: l.riggingMassKg,
        chartLimitMs: setup.chartLimitMs,
      });
      return `Permitted ${speed(r.permittedMs)} · ${r.areaToMassRatio.toFixed(2)} m²/t${r.reduced ? '' : ' (chart limit)'}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  function row(l: ScheduleLoad): HTMLElement {
    const out = h('div', { class: 'load-result', 'aria-live': 'polite' }, resultText(l));
    const update = () => {
      out.textContent = resultText(l);
      changed();
    };
    const num = (label: string, key: 'lengthM' | 'heightM' | 'massKg' | 'riggingMassKg' | 'dragCoefficient') => {
      const input = h('input', {
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        value: Number.isFinite(l[key]) ? String(l[key]) : '',
        'aria-label': `${l.ref || 'Load'} ${label}`,
      });
      input.addEventListener('input', () => {
        l[key] = readNumber(input) ?? Number.NaN;
        update();
      });
      return h('label', { class: 'mini' }, h('span', null, label), input);
    };
    const ref = h('input', { type: 'text', value: l.ref, placeholder: 'Reference, e.g. W12', 'aria-label': 'Load reference' });
    ref.addEventListener('input', () => {
      l.ref = ref.value;
      update();
    });
    const remove = h('button', { type: 'button', class: 'btn small', 'aria-label': `Remove ${l.ref || 'load'}` }, 'Remove');
    remove.addEventListener('click', () => {
      setup.extraLoads = setup.extraLoads.filter((x) => x.id !== l.id);
      render();
      changed();
    });
    return h(
      'div',
      { class: 'load-row' },
      h('div', { class: 'inline' }, ref, remove),
      h('div', { class: 'mini-grid' }, num('Length m', 'lengthM'), num('Height m', 'heightM'), num('Mass kg', 'massKg'), num('Rigging kg', 'riggingMassKg'), num('cw', 'dragCoefficient')),
      out,
    );
  }

  function render(): void {
    clear(list);
    if (setup.extraLoads.length === 0) list.append(h('p', { class: 'muted small' }, 'None yet. Add the other loads in this lift plan, or paste them from a panel schedule.'));
    setup.extraLoads.forEach((l) => list.append(row(l)));
  }

  const paste = h('textarea', { rows: 5, placeholder: 'W01\t3.6\t2.4\t1300\nW02\t4.8\t2.4\t1650' });
  const importBtn = h('button', { type: 'button', class: 'btn small' }, 'Add these loads');
  importBtn.addEventListener('click', () => {
    const { loads, errors } = parseLoadSchedule(paste.value, defaults());
    setup.extraLoads = [...setup.extraLoads, ...loads];
    render();
    changed();
    clear(pasteMsg);
    pasteMsg.append(h('p', null, `${loads.length} load${loads.length === 1 ? '' : 's'} added.`));
    if (errors.length) pasteMsg.append(h('ul', { class: 'small' }, errors.map((e) => h('li', { class: 'error-text' }, e))));
    if (!errors.length) paste.value = '';
  });

  const add = h('button', { type: 'button', class: 'btn small' }, '+ Add a load');
  add.addEventListener('click', () => {
    const l = newScheduleLoad(defaults());
    setup.extraLoads = [...setup.extraLoads, l];
    render();
    changed();
    (list.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
  });

  render();
  return h(
    'div',
    null,
    list,
    h('div', { class: 'actions' }, add),
    h(
      'details',
      { class: 'more', style: 'margin-top:8px' },
      h('summary', null, 'Paste from a panel schedule'),
      h(
        'p',
        { class: 'small muted' },
        'Copy rows from the supplier’s panel schedule or a spreadsheet: reference, length (m), height (m), mass (kg, or tonnes with “t”), and optionally rigging (kg) and cw. A header row is skipped.',
      ),
      paste,
      h('div', { class: 'actions' }, importBtn),
      pasteMsg,
    ),
  );
}
