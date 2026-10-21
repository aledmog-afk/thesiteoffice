import { lookupPostcode, manualLocation, PostcodeError } from '../../data/postcode';
import { loadResult } from '../../lift/assessment';
import { validateSetup, type LiftSetup, type SetupErrors, type SetupField } from '../../lift/setup';
import { gustHeightFactor, NEAR_LIMIT_RATIO, REFERENCE_AREA_RATIO } from '../../wind';
import type { Ctx } from '../app';
import { clear, h, readNumber } from '../dom';
import { card, field, numberInput, textInput, type FieldHandle } from '../fields';
import { addDays, longDate, num, speed, ukToday } from '../format';
import { saveSetup } from '../state';

export function setupScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const setup = state.setup;
  const handles: Partial<Record<SetupField, FieldHandle>> = {};
  const touched = new Set<SetupField>();
  let showAll = false;

  const working = h('div', { class: 'working', 'aria-live': 'polite' });

  function changed(): void {
    saveSetup(setup);
    // Anything the assessment depends on may have changed.
    state.assessment = null;
    refresh();
  }

  function set<K extends keyof LiftSetup>(key: K, value: LiftSetup[K]): void {
    setup[key] = value;
    touched.add(key);
    changed();
  }

  function refresh(): void {
    const errors = validateSetup(setup);
    for (const [key, handle] of Object.entries(handles) as [SetupField, FieldHandle][]) {
      handle.setError(showAll || touched.has(key) ? errors[key] : undefined);
    }
    renderWorking(errors);
  }

  function track(key: SetupField, handle: FieldHandle, control: HTMLElement): HTMLElement {
    handles[key] = handle;
    control.addEventListener('blur', () => {
      touched.add(key);
      refresh();
    });
    return handle.el;
  }

  // ---------- Site ----------
  const siteBox = h('div');
  // What the user has typed, kept across rebuilds of the site box.
  let pcDraft = setup.site?.postcode ?? '';
  function renderSite(message?: string, busy = false): void {
    clear(siteBox);
    const pc = h('input', {
      type: 'text',
      autocomplete: 'postal-code',
      autocapitalize: 'characters',
      placeholder: 'e.g. M1 1AE',
      value: pcDraft,
      'aria-describedby': 'pc-msg',
    });
    pc.addEventListener('input', () => (pcDraft = pc.value));
    const find = async () => {
      renderSite(undefined, true);
      try {
        setup.site = await lookupPostcode(pcDraft);
        pcDraft = setup.site.postcode ?? pcDraft;
        touched.add('site');
        changed();
        renderSite();
      } catch (err) {
        renderSite(err instanceof PostcodeError ? err.message : 'Postcode lookup failed.');
      }
    };
    pc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void find();
      }
    });

    const lat = h('input', { type: 'text', inputmode: 'decimal', placeholder: '53.4808', value: setup.site && !setup.site.postcode ? String(setup.site.latitude) : '' });
    const lon = h('input', { type: 'text', inputmode: 'decimal', placeholder: '-2.2426', value: setup.site && !setup.site.postcode ? String(setup.site.longitude) : '' });
    const useLatLon = () => {
      try {
        setup.site = manualLocation(readNumber(lat) ?? Number.NaN, readNumber(lon) ?? Number.NaN);
        touched.add('site');
        changed();
        renderSite();
      } catch (err) {
        renderSite(err instanceof PostcodeError ? err.message : 'Check the latitude and longitude.');
      }
    };

    siteBox.append(
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'pc' }, 'Site postcode'),
        h(
          'div',
          { class: 'inline' },
          Object.assign(pc, { id: 'pc' }),
          h('button', { class: 'btn primary', type: 'button', onclick: find, disabled: busy }, busy ? 'Finding…' : 'Find'),
        ),
        h('div', { id: 'pc-msg', role: 'status' }, message ? h('div', { class: 'error' }, message) : null),
      ),
      h(
        'details',
        { class: 'more', open: !!(setup.site && !setup.site.postcode) },
        h('summary', null, 'Or enter latitude and longitude'),
        h(
          'div',
          { class: 'row' },
          field('Latitude', lat).el,
          field('Longitude', lon).el,
        ),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: useLatLon }, 'Use these')),
      ),
    );
    if (setup.site) {
      siteBox.append(
        h('p', { class: 'notice' }, h('strong', null, 'Site: '), setup.site.label, h('br'), h('span', { class: 'small' }, `${setup.site.latitude.toFixed(4)}, ${setup.site.longitude.toFixed(4)}`)),
      );
    }
  }
  // The site error sits under the site box, which is rebuilt after each lookup.
  const siteErrLine = h('div', { class: 'error', role: 'alert', hidden: true });
  const siteErr = h('div', { class: 'field' }, siteErrLine);
  renderSite();
  const siteHandle: FieldHandle = {
    el: siteBox,
    setError(m) {
      siteErrLine.hidden = !m;
      siteErrLine.textContent = m ?? '';
    },
  };

  // ---------- Lift ----------
  const today = ukToday();
  const date = h('input', { type: 'date', value: setup.liftDate, min: today, max: addDays(today, 6) });
  date.addEventListener('input', () => set('liftDate', date.value));
  const start = h('input', { type: 'time', value: setup.windowStart, step: 900 });
  start.addEventListener('input', () => set('windowStart', start.value));
  const end = h('input', { type: 'time', value: setup.windowEnd, step: 900 });
  end.addEventListener('input', () => set('windowEnd', end.value));
  const crane = h('textarea', { rows: 2, placeholder: 'e.g. Liebherr LTM 1090-4.2, 40 t counterweight, 32 m radius' });
  crane.value = setup.craneDescription;
  crane.addEventListener('input', () => set('craneDescription', crane.value));

  // ---------- Crane limit ----------
  const limit = numberInput(setup.chartLimitMs, (v) => set('chartLimitMs', v), { placeholder: 'e.g. 17' });
  const limitSource = textInput(setup.chartLimitSource, (v) => set('chartLimitSource', v), {
    placeholder: 'e.g. Lift plan LP-014 / LTM 1090 load chart',
  });
  const typeGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'lt-label' });
  for (const [value, label, desc] of [
    ['gust', 'Gust', '3-second gust (EN 13000 charts)'],
    ['mean', 'Mean', '10-minute mean'],
  ] as const) {
    const radio = h('input', { type: 'radio', name: 'limitType', value, checked: setup.chartLimitType === value });
    radio.addEventListener('change', () => set('chartLimitType', value));
    typeGroup.append(h('label', { class: 'choice' }, radio, h('span', null, h('span', { class: 't' }, label), h('span', { class: 'd' }, desc))));
  }
  const typeErr = h('div', { class: 'error', role: 'alert', hidden: true });
  handles.chartLimitType = {
    el: typeGroup,
    setError(m) {
      typeErr.hidden = !m;
      typeErr.textContent = m ?? '';
    },
  };
  const height = numberInput(setup.heightM, (v) => set('heightM', v), { placeholder: 'e.g. 30' });

  // ---------- Load ----------
  const loadDesc = textInput(setup.loadDescription, (v) => set('loadDescription', v), { placeholder: 'e.g. External wall panel W12 (optional)' });
  const len = numberInput(setup.loadLengthM, (v) => set('loadLengthM', v), { placeholder: '3.6' });
  const ht = numberInput(setup.loadHeightM, (v) => set('loadHeightM', v), { placeholder: '2.4' });
  const mass = numberInput(setup.loadMassKg, (v) => set('loadMassKg', v), { placeholder: '1300' });
  const rig = numberInput(setup.riggingMassKg, (v) => set('riggingMassKg', v), { placeholder: '0' });
  const cw = numberInput(setup.dragCoefficient, (v) => set('dragCoefficient', v), { placeholder: '1.2' });

  // ---------- Working ----------
  function renderWorking(errors: SetupErrors): void {
    clear(working);
    let result;
    try {
      result = loadResult(setup);
    } catch {
      working.append(
        h('p', { class: 'muted' }, 'Enter the chart limit, load size and mass to see the permitted wind speed and the working.'),
      );
      return;
    }
    const steps = h(
      'ol',
      null,
      result.steps.map((step) =>
        h('li', null, h('span', { class: 'lbl' }, step.label), h('span', { class: 'v' }, `${num(step.value, step.unit === 'm/s' ? 2 : 3)} ${step.unit}`), h('span', { class: 'f' }, step.formula)),
      ),
    );
    working.append(
      steps,
      h(
        'div',
        { class: 'result' },
        h('span', null, 'Permitted wind speed for this load'),
        h('span', { class: 'big' }, speed(result.permittedMs, 1)),
      ),
      h(
        'p',
        { class: 'small muted', style: 'margin-top:8px' },
        result.reduced
          ? `The load's wind area per tonne (${num(result.areaToMassRatio, 2)} m²/t) is above the ${REFERENCE_AREA_RATIO} m²/t the chart assumes, so the limit is reduced.`
          : `The load's wind area per tonne (${num(result.areaToMassRatio, 2)} m²/t) is not above ${REFERENCE_AREA_RATIO} m²/t, so the chart limit applies unchanged.`,
      ),
    );
    if (!errors.heightM && setup.heightM) {
      const f = gustHeightFactor(setup.heightM);
      working.append(
        h(
          'ol',
          null,
          h('li', null, h('span', { class: 'lbl' }, `Gust factor at ${setup.heightM} m`), h('span', { class: 'v' }, `× ${num(f, 3)}`), h('span', { class: 'f' }, 'Liebherr factors quoted by CPA, log-height interpolation')),
          h('li', null, h('span', { class: 'lbl' }, 'Near limit from (gust at height)'), h('span', { class: 'v' }, speed(result.permittedMs * NEAR_LIMIT_RATIO)), h('span', { class: 'f' }, `${NEAR_LIMIT_RATIO * 100} % of the permitted speed`)),
          h('li', null, h('span', { class: 'lbl' }, 'Same limit as a 10 m forecast gust'), h('span', { class: 'v' }, speed(result.permittedMs / f)), h('span', { class: 'f' }, `${num(result.permittedMs, 2)} ÷ ${num(f, 3)}`)),
        ),
      );
    }
  }

  const go = h('button', { class: 'btn primary block', type: 'button' }, 'Check against the forecast →');
  go.addEventListener('click', () => {
    showAll = true;
    refresh();
    const errors = validateSetup(setup);
    if (Object.keys(errors).length === 0) {
      ctx.go('assessment');
    } else {
      const firstKey = (Object.keys(handles) as SetupField[]).find((k) => errors[k]);
      const target = firstKey === 'site' ? siteBox.querySelector('input') : handles[firstKey!]?.el.querySelector('input, textarea');
      (target as HTMLElement | null)?.focus();
    }
  });

  handles.site = siteHandle;
  const el = h(
    'div',
    null,
    h('h1', { tabindex: -1 }, 'Lift set-up'),
    h('p', { class: 'lede' }, 'Enter the lift as planned. The permitted wind speed and the working update as you type.'),
    card(h('h2', null, 'Site'), siteBox, siteErr),
    card(
      h('h2', null, 'Lift'),
      track('liftDate', field('Lift date', date, `${longDate(today)} to ${longDate(addDays(today, 6))} (7-day forecast)`), date),
      h(
        'div',
        { class: 'row' },
        track('windowStart', field('Planned start', start), start),
        track('windowEnd', field('Planned finish', end), end),
      ),
      h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Leave start and finish empty to assess sunrise to sunset.'),
      track('craneDescription', field('Crane', crane, 'Make, model and configuration'), crane),
    ),
    card(
      h('h2', null, 'Crane wind limit'),
      track('chartLimitMs', field('In-service wind limit from the load chart (m/s)', limit, 'For this configuration and duty'), limit),
      track('chartLimitSource', field('Where this figure came from', limitSource, 'Required. Lift plan reference, load chart, manufacturer data'), limitSource),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'lt-label' }, 'The limit is a'), typeGroup, typeErr),
      track('heightM', field('Height for the wind correction (m)', height, 'The higher of the jib head and the load during the lift. Up to 150 m.'), height),
    ),
    card(
      h('h2', null, 'Load'),
      field('Load description', loadDesc).el,
      h(
        'div',
        { class: 'row' },
        track('loadLengthM', field('Length (m)', len, 'Face to the wind'), len),
        track('loadHeightM', field('Height (m)', ht, 'Face to the wind'), ht),
      ),
      h(
        'div',
        { class: 'row' },
        track('loadMassKg', field('Load mass (kg)', mass), mass),
        track('riggingMassKg', field('Rigging mass (kg)', rig), rig),
      ),
      h('div', { style: 'margin-top:14px' }, track('dragCoefficient', field('Drag coefficient cw', cw, '1.2 for flat panels (EN 13000). Change only with a source.'), cw)),
    ),
    card(h('h2', null, 'Working'), working),
    go,
  );
  refresh();
  return el;
}
