import './styles.css';
import { startApp } from './ui/app';

startApp(document.getElementById('app')!);

// Offline support (public/sw.js). Production builds only, so development always
// sees fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb) : setTimeout(cb, 3000));
        idle(async () => {
          // Load the PDF library once while there is signal, so PDFs work offline too,
          // then hand every file this page has loaded to the worker to keep.
          await import('jspdf').catch(() => undefined);
          const urls = performance
            .getEntriesByType('resource')
            .map((e) => new URL(e.name).pathname)
            .filter((p) => p.startsWith('/assets/'));
          reg.active?.postMessage({ type: 'cache', urls });
        });
      })
      .catch(() => undefined);
  });
}
