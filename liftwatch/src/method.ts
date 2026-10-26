import './styles.css';
import method from '../METHOD.md?raw';
import { APP_NAME, TEST_VERSION_NOTICE } from './config';
import { safeStorage } from './ui/dom';
import { renderMarkdown } from './ui/markdown';

// Same theme choice as the app.
const theme = safeStorage.get('liftwatch.theme');
if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);

document.title = `${APP_NAME} method`;
const root = document.getElementById('app')!;
// METHOD.md is part of the build, not user input, and renderMarkdown escapes all text.
root.innerHTML = `
  <div class="top">
    <div class="test-banner" role="note">${TEST_VERSION_NOTICE}</div>
    <header class="topbar">
      <div class="brand">${APP_NAME}<small>Method and sources</small></div>
      <div class="links"><a href="/">← Back to the app</a></div>
    </header>
  </div>
  <main><article class="card method">${renderMarkdown(method)}</article></main>`;
