import { h, readNumber, uid, type Child } from './dom';

export interface FieldHandle {
  el: HTMLElement;
  setError: (message: string | undefined) => void;
}

/** Wraps a control with its label, hint and an error line that screen readers hear. */
export function field(label: string, control: HTMLElement, hint?: string): FieldHandle {
  const id = control.id || uid('f');
  control.id = id;
  const errId = `${id}-err`;
  const hintId = hint ? `${id}-hint` : undefined;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  const err = h('div', { class: 'error', id: errId, role: 'alert', hidden: true });
  const el = h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    hint ? h('span', { class: 'hint', id: hintId }, hint) : null,
    control,
    err,
  );
  return {
    el,
    setError(message) {
      err.hidden = !message;
      err.textContent = message ?? '';
      control.setAttribute('aria-invalid', message ? 'true' : 'false');
      control.setAttribute('aria-describedby', [hintId, message ? errId : undefined].filter(Boolean).join(' '));
    },
  };
}

export function numberInput(value: number | null, onValue: (v: number | null) => void, attrs: Record<string, unknown> = {}): HTMLInputElement {
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: value === null || Number.isNaN(value) ? '' : String(value),
    ...attrs,
  });
  input.addEventListener('input', () => onValue(readNumber(input)));
  return input;
}

export function textInput(value: string, onValue: (v: string) => void, attrs: Record<string, unknown> = {}): HTMLInputElement {
  const input = h('input', { type: 'text', value, ...attrs });
  input.addEventListener('input', () => onValue(input.value));
  return input;
}

export function card(...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, ...children);
}
