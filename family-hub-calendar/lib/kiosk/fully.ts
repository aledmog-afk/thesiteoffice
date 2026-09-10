'use client';

/**
 * Fully Kiosk Browser injects a `fully` object into the page. Whether it is
 * present depends on the licence tier, which could not be verified while this
 * was written (see §5 of ARCHITECTURE.md), so every call is feature-detected
 * and no behaviour depends on it: the CSS overlay is the real mechanism and
 * this is an enhancement that lights up on its own if available.
 */
type FullyInterface = {
  setScreenBrightness?: (value: number) => void;
  getScreenBrightness?: () => number;
  turnScreenOn?: () => void;
};

function fully(): FullyInterface | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as { fully?: FullyInterface }).fully;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

export function hasFullyBrightness(): boolean {
  return typeof fully()?.setScreenBrightness === 'function';
}

/**
 * Maps overlay opacity onto real backlight. Never goes fully dark: a black
 * panel reads as a broken tablet, so the floor is 8%.
 */
export function applyFullyBrightness(opacity: number): boolean {
  const api = fully();
  if (typeof api?.setScreenBrightness !== 'function') return false;

  const clamped = Math.max(0, Math.min(1, opacity));
  const level = Math.round(255 * (1 - clamped * 0.92));
  try {
    api.setScreenBrightness(level);
    return true;
  } catch {
    // A licence-gated call can exist and still throw; the overlay covers us.
    return false;
  }
}
