import { APP_NAME } from '../config';
import { createDefaultStore } from '../storage/indexeddb';
import { clear, h, safeStorage } from './dom';
import { assessmentScreen } from './screens/assessment';
import { decisionScreen } from './screens/decision';
import { recordsScreen } from './screens/records';
import { setupScreen } from './screens/setup';
import { createState, type AppState, type Screen } from './state';

export interface Ctx {
  state: AppState;
  /** Switch screen and rebuild it. */
  go: (screen: Screen) => void;
  /** Rebuild the current screen (after async work finishes). */
  rerender: () => void;
}

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'liftwatch.theme';

function applyTheme(theme: Theme): void {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

const TABS: { screen: Screen; n: string; label: string }[] = [
  { screen: 'setup', n: '1', label: 'Set-up' },
  { screen: 'assessment', n: '2', label: 'Assessment' },
  { screen: 'decision', n: '3', label: 'Decision' },
  { screen: 'records', n: '☰', label: 'Records' },
];

export function startApp(root: HTMLElement): void {
  document.title = APP_NAME;
  let theme = (safeStorage.get(THEME_KEY) as Theme | null) ?? 'auto';
  applyTheme(theme);

  const { store, persistent } = createDefaultStore();
  const state = createState(store, persistent);

  const ctx: Ctx = {
    state,
    go(screen) {
      state.screen = screen;
      render();
      window.scrollTo(0, 0);
      (root.querySelector('main h1') as HTMLElement | null)?.focus();
    },
    rerender: () => render(),
  };

  function themeButton(): HTMLButtonElement {
    const names: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    return h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        'aria-label': `Theme: ${names[theme]}. Change theme`,
        onclick: () => {
          theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
          safeStorage.set(THEME_KEY, theme);
          applyTheme(theme);
          render();
        },
      },
      `Theme: ${names[theme]}`,
    );
  }

  function render(): void {
    const scrollY = window.scrollY;
    clear(root);
    const screens: Record<Screen, (c: Ctx) => HTMLElement> = {
      setup: setupScreen,
      assessment: assessmentScreen,
      decision: decisionScreen,
      records: recordsScreen,
    };
    root.append(
      h(
        'header',
        { class: 'topbar' },
        h('div', { class: 'brand' }, APP_NAME, h('small', null, 'Wind check for crane lifts · decision support')),
        themeButton(),
      ),
      h('main', null, screens[state.screen](ctx)),
      h(
        'nav',
        { class: 'tabs', 'aria-label': 'Screens' },
        TABS.map((t) =>
          h(
            'button',
            { type: 'button', 'aria-current': state.screen === t.screen ? 'page' : null, onclick: () => ctx.go(t.screen) },
            h('span', { class: 'n', 'aria-hidden': 'true' }, t.n),
            t.label,
          ),
        ),
      ),
    );
    window.scrollTo(0, scrollY);
  }

  render();
}
