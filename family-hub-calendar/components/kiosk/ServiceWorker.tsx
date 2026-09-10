'use client';

import { useEffect } from 'react';

/** Registers the (non-caching) worker that makes the app installable. */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Errors here are never fatal: without a worker the app still runs, it
    // just cannot be installed to the home screen.
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
