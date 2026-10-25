import { BANNER_SUFFIX, DISCLAIMER, FORECAST_CONFIG } from '../../config';
import { fetchForecast, ForecastFetchError } from '../../data/forecast';
import { londonLocalToEpoch } from '../../time/london';
import { loadCachedForecast, saveForecast } from '../../data/forecastCache';
import { ForecastFormatError } from '../../data/openMeteo';
import type { LiftAssessment } from '../../lift/assessment';
import { compassPoint, factorTerrain, FLAG_LABEL, STATUS_LABEL, type FlagCode, type HourAssessment, type Status } from '../../wind';
import { heightFactorSource, terrainText } from '../../lift/display';
import type { Ctx } from '../app';
import { hourlyChart } from '../chart';
import { clear, h, type Child } from '../dom';
import { card } from '../fields';
import { direction, hhmm, hourLabel, instant, longDate, num, pct, shortDate, speed, STATUS_ICON, statusLabel } from '../format';
import { recompute, saveSetup, setupReady, siteKey, type AppState } from '../state';

export function statusPill(status: Status | null): HTMLElement {
  const st = status ?? 'no-data';
  return h('span', { class: `pill st-${st}` }, h('span', { 'aria-hidden': 'true' }, STATUS_ICON[st]), statusLabel(status));
}

export function banner(status: Status): HTMLElement {
  return h(
    'div',
    { class: `banner st-${status}`, role: 'status' },
    h('span', { class: 'icon', 'aria-hidden': 'true' }, STATUS_ICON[status]),
    h('div', null, h('div', { class: 'label' }, STATUS_LABEL[status]), h('div', { class: 'sub' }, `— ${BANNER_SUFFIX}`)),
  );
}

async function loadForecast(ctx: Ctx): Promise<void> {
  const { state } = ctx;
  const site = state.setup.site;
  if (!site || state.loading) return;
  state.loading = true;
  state.forecastError = null;
  const key = siteKey(state.setup);
  try {
    state.forecast = await fetchForecast(site.latitude, site.longitude);
    state.forecastKey = key;
    state.forecastOffline = false;
    if (key) saveForecast(key, state.forecast);
    recompute(state);
  } catch (err) {
    const saved = key ? loadCachedForecast(key) : null;
    if (saved) {
      // No signal: fall back to the last forecast for this site, clearly labelled.
      state.forecast = saved;
      state.forecastKey = key;
      state.forecastOffline = true;
      recompute(state);
    } else {
      state.forecastError =
        err instanceof ForecastFetchError || err instanceof ForecastFormatError ? err.message : 'The forecast could not be loaded.';
    }
  } finally {
    state.loading = false;
    if (state.screen === 'assessment') ctx.rerender();
  }
}

export function assessmentScreen(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const title = h('h1', { tabindex: -1 }, 'Assessment');

  if (!setupReady(state.setup)) {
    return h(
      'div',
      null,
      title,
      card(
        h('p', null, 'Finish the lift set-up first. Every required field must be filled in before the forecast can be assessed.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('setup') }, '← Back to set-up'),
      ),
    );
  }

  const key = siteKey(state.setup);
  if ((!state.forecast || state.forecastKey !== key) && !state.forecastError) {
    void loadForecast(ctx);
  }
  if (state.loading || ((!state.forecast || state.forecastKey !== key) && !state.forecastError)) {
    return h('div', null, title, card(h('p', { role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Loading the forecast…')));
  }
  if (state.forecastError) {
    return h(
      'div',
      null,
      title,
      h('div', { class: 'notice warn', role: 'alert' }, h('strong', null, 'No forecast. '), state.forecastError),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            state.forecastError = null;
            ctx.rerender();
          },
        },
        'Try again',
      ),
    );
  }

  if (!state.assessment && !state.assessmentError) recompute(state);
  if (state.assessmentError || !state.assessment) {
    return h(
      'div',
      null,
      title,
      h('div', { class: 'notice warn', role: 'alert' }, h('strong', null, 'Cannot assess. '), state.assessmentError ?? 'Unknown problem.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('setup') }, '← Back to set-up'),
    );
  }

  const a = state.assessment;
  return h(
    'div',
    null,
    title,
    h('p', { class: 'lede' }, `${longDate(a.liftDate)} · ${state.setup.site!.label}`),
    state.forecastOffline
      ? h(
          'div',
          { class: 'notice warn', role: 'alert' },
          h('strong', null, 'Offline: saved forecast. '),
          `No connection, so this uses the forecast saved on this phone, fetched ${instant(state.forecast!.fetchedAt)}. Refresh when you have signal.`,
        )
      : null,
    banner(a.overallStatus),
    a.loads && a.loads.length > 1
      ? h('p', { class: 'notice' }, h('strong', null, `Governing load: ${a.governingRef}`), ` — the most wind-sensitive of ${a.loads.length} loads (permitted ${speed(a.load.permittedMs)}).`)
      : null,
    summary(a),
    a.loads && a.loads.length > 1 ? loadsCard(a) : null,
    forecastSource(ctx),
    dayChart(state, a),
    periodsCard(a),
    outlookCard(ctx, a),
    h('p', { class: 'disclaimer' }, DISCLAIMER),
    h('button', { class: 'btn primary block', type: 'button', onclick: () => ctx.go('decision') }, 'Record decision →'),
  );
}

function windowText(a: LiftAssessment): string {
  const span = `${hhmm(a.windowStart)}–${hhmm(a.windowEnd)}`;
  return a.windowDefaulted ? `${span} (sunrise to sunset)` : `${span} (planned)`;
}

/** Union of flags over hours, with the number of hours each applies to. */
export function flagCounts(hours: HourAssessment[]): { code: FlagCode; label: string; hours: number }[] {
  const counts = new Map<FlagCode, number>();
  for (const hr of hours) for (const f of hr.flags) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  return [...counts.entries()].map(([code, n]) => ({ code, label: FLAG_LABEL[code], hours: n }));
}

function summary(a: LiftAssessment): HTMLElement {
  const w = a.worst;
  const flags = flagCounts(a.windowHours);
  const stat = (k: string, v: Child, sub?: Child, wide = false) =>
    h('div', { class: `stat${wide ? ' wide' : ''}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('div', { class: 's' }, sub) : null);

  return h(
    'div',
    null,
    h('p', { class: 'small muted' }, `Worst hour in the window ${windowText(a)}${w ? `: ${hourLabel(w)}` : ''}.`),
    h(
      'div',
      { class: 'stats' },
      stat('Gust at height', speed(w?.gustAtHeightMs), `at ${a.heightM} m (10 m gust ${speed(w?.gust10mMs)} × ${num(a.heightFactor, 3)}, ${heightFactorSource(a.terrain, factorTerrain(a.heightM))}). Terrain: ${terrainText(a.terrain)}`, true),
      stat('Permitted', speed(a.load.permittedMs), a.load.reduced ? 'reduced for wind area' : 'chart limit', true),
      stat('% of limit', pct(w?.percentOfLimit, w?.status)),
      stat('Direction', w?.windDirectionDeg != null ? compassPoint(w.windDirectionDeg) : '–', w?.windDirectionDeg != null ? `Wind ${direction(w.windDirectionDeg)}` : undefined),
    ),
    card(
      h('h2', null, 'Flags in the window'),
      flags.length
        ? h('ul', { class: 'flags' }, flags.map((f) => h('li', { class: 'flag' }, `${f.label} · ${f.hours} h`)))
        : h('p', { class: 'muted' }, 'None of the weather flags are raised for this window.'),
      h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Flags never count as a pass. Check conditions on site.'),
    ),
  );
}

function forecastSource(ctx: Ctx): HTMLElement {
  const f = ctx.state.forecast!;
  return card(
    h('h2', null, 'Forecast'),
    h(
      'dl',
      { class: 'source' },
      h('div', null, h('dt', null, 'Source: '), h('dd', null, h('a', { href: FORECAST_CONFIG.sourceUrl, target: '_blank', rel: 'noopener' }, f.source), ` (${f.endpoint})`)),
      h('div', null, h('dt', null, 'Model: '), h('dd', null, f.model)),
      h('div', null, h('dt', null, 'Fetched: '), h('dd', null, instant(f.fetchedAt))),
      h('div', null, h('dt', null, 'Grid point: '), h('dd', null, `${f.latitude.toFixed(3)}, ${f.longitude.toFixed(3)}${f.elevationM !== null ? `, ${Math.round(f.elevationM)} m elevation` : ''}`)),
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          onclick: () => {
            ctx.state.forecast = null;
            ctx.state.forecastKey = null;
            ctx.rerender();
          },
        },
        '↻ Refresh forecast',
      ),
    ),
  );
}

function hourDetail(hr: HourAssessment | undefined): Child[] {
  if (!hr) return ['Tap a bar to see that hour.'];
  return [
    h('strong', null, hourLabel(hr)),
    ' · ',
    statusPill(hr.status),
    h('br'),
    'Gust at height ',
    h('strong', null, speed(hr.gustAtHeightMs)),
    ` vs permitted ${speed(hr.permittedMs)} · `,
    h('strong', null, pct(hr.percentOfLimit, hr.status)),
    h('br'),
    `Wind ${direction(hr.windDirectionDeg)}`,
    hr.flags.length ? [h('br'), 'Flags: ', hr.flags.map((f) => f.label).join(', ')] : null,
  ];
}

function dayChart(state: AppState, a: LiftAssessment): HTMLElement {
  const detail = h('div', { class: 'hour-detail', 'aria-live': 'polite' });
  const pick = (time: string | null) => {
    state.selectedHour = time;
    clear(detail);
    detail.append(h('div', null, hourDetail(a.liftDayHours.find((x) => x.time === time))));
  };
  const initial = state.selectedHour && state.selectedHour.startsWith(a.liftDate) ? state.selectedHour : (a.worst?.time ?? null);
  pick(initial);

  const table = h(
    'details',
    { class: 'more' },
    h('summary', null, 'Hour by hour table'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, '10 m gust'), h('th', null, 'At height'), h('th', null, '% limit'), h('th', { class: 'l' }, 'Status'), h('th', null, 'Dir'), h('th', { class: 'l' }, 'Flags'))),
        h(
          'tbody',
          null,
          a.liftDayHours.map((hr) =>
            h(
              'tr',
              { class: hr.daylight ? null : 'is-night' },
              h('td', null, hourLabel(hr)),
              h('td', null, num(hr.gust10mMs, 1)),
              h('td', null, num(hr.gustAtHeightMs, 1)),
              h('td', null, pct(hr.percentOfLimit, hr.status)),
              h('td', { class: 'l' }, STATUS_LABEL[hr.status]),
              h('td', null, hr.windDirectionDeg === null ? '–' : `${Math.round(hr.windDirectionDeg)}°`),
              h('td', { class: 'l' }, hr.flags.map((f) => f.label).join(', ') || '–'),
            ),
          ),
        ),
      ),
      h('p', { class: 'small muted' }, 'Speeds in m/s. Gust at height = 10 m gust × height factor.'),
    ),
  );

  return card(
    h('h2', null, `Lift day: gust at ${a.heightM} m vs permitted`),
    h(
      'div',
      { class: 'legend' },
      h('span', null, h('i', { class: 'sw', style: 'background:var(--within-mark)' }), 'Within'),
      h('span', null, h('i', { class: 'sw', style: 'background:var(--near-mark)' }), 'Near'),
      h('span', null, h('i', { class: 'sw', style: 'background:var(--over-mark)' }), 'Over'),
      h('span', null, h('i', { class: 'sw line' }), 'Permitted limit'),
      h('span', null, h('i', { class: 'sw night' }), 'Night'),
      h('span', null, h('i', { class: 'sw win' }), 'Lift window'),
    ),
    hourlyChart({
      hours: a.liftDayHours,
      permittedMs: a.load.permittedMs,
      windowStartMs: a.windowStartMs ?? londonLocalToEpoch(a.windowStart),
      windowEndMs: a.windowEndMs ?? londonLocalToEpoch(a.windowEnd, 'later'),
      selected: initial,
      onSelect: pick,
    }),
    detail,
    table,
  );
}

/** Which loads are within limits in each daylight hour: helps sequence the day (CPA page 22). */
export function loadsCard(a: LiftAssessment): HTMLElement {
  const loads = [...a.loads].sort((x, y) => x.result.permittedMs - y.result.permittedMs);
  const cols = a.liftDayHours.map((hr, i) => ({ hr, i })).filter(({ hr }) => hr.daylight);
  const icon = (st: Status) => h('span', { class: `cell st-${st}`, title: STATUS_LABEL[st] }, STATUS_ICON[st]);
  return card(
    h('h2', null, 'Loads hour by hour'),
    h(
      'p',
      { class: 'small muted' },
      'Most wind-sensitive first. Plan the light, large loads for the calmest hours and the heavy, compact ones for the windier hours (CPA page 22).',
    ),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'matrix' },
        h(
          'thead',
          null,
          h('tr', null, h('th', { class: 'l sticky' }, 'Load'), h('th', null, 'Permitted'), cols.map(({ hr }) => h('th', null, hourLabel(hr).replace(':00', '')))),
        ),
        h(
          'tbody',
          null,
          loads.map((l) =>
            h(
              'tr',
              null,
              h('th', { class: 'l sticky', scope: 'row' }, l.ref, l.ref === a.governingRef ? h('span', { class: 'tag' }, 'governs') : null),
              h('td', null, `${l.result.permittedMs.toFixed(1)}`),
              cols.map(({ i }) => h('td', { class: 'c' }, icon(l.statuses[i]))),
            ),
          ),
        ),
      ),
    ),
    h('p', { class: 'small muted' }, `Daylight hours only. Permitted in m/s. ${STATUS_ICON.within} within, ${STATUS_ICON.near} near, ${STATUS_ICON.over} over limit.`),
    h(
      'ul',
      { class: 'periods' },
      loads.map((l) =>
        h(
          'li',
          null,
          `${l.ref}: `,
          h('span', { style: 'font-weight:400' }, l.periods.length ? `within limits ${l.periods.map((p) => `${hhmm(p.start)}–${hhmm(p.end)}`).join(', ')}` : 'no daylight hour within limits'),
        ),
      ),
    ),
  );
}

function periodsCard(a: LiftAssessment): HTMLElement {
  return card(
    h('h2', null, 'Daylight periods within limits (2 h or more) ', h('span', { class: 'tag' }, 'Planning guidance only')),
    a.periods.length
      ? h('ul', { class: 'periods' }, a.periods.map((p) => h('li', null, `${hhmm(p.start)}–${hhmm(p.end)} · ${p.hours} h`)))
      : h('p', { class: 'muted' }, 'No daylight period of 2 hours or more is within limits on this day.'),
  );
}

function outlookCard(ctx: Ctx, a: LiftAssessment): HTMLElement {
  return card(
    h('h2', null, 'Outlook — planning guidance only'),
    h('p', { class: 'small muted' }, 'Worst daylight hour each day against the limits you entered. Tap a day to assess it.'),
    h(
      'div',
      { class: 'outlook' },
      a.outlook.map((d) =>
        h(
          'button',
          {
            class: 'day',
            type: 'button',
            'aria-pressed': d.date === a.liftDate ? 'true' : 'false',
            onclick: () => {
              ctx.state.setup.liftDate = d.date;
              saveSetup(ctx.state.setup);
              ctx.state.selectedHour = null;
              recompute(ctx.state);
              ctx.rerender();
            },
          },
          h('div', { class: 'd' }, shortDate(d.date)),
          h('div', { style: 'margin-top:6px' }, statusPill(d.worstStatus)),
          h('div', { class: 'g' }, `Max ${speed(d.maxGustAtHeightMs, 1)}`),
          h('div', { class: 'g' }, `${d.daylightHoursWithin} of ${d.daylightHours} daylight h within`),
        ),
      ),
    ),
  );
}
