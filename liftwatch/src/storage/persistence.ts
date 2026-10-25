/**
 * Keeping records on the device: persistent storage and export reminders.
 *
 * Records live only in this browser (IndexedDB). Without persistent storage the
 * browser may clear them to free space. `navigator.storage.persist()` asks it not
 * to; the browser decides, and the answer is shown on the Records screen.
 */

export type PersistState = 'pending' | 'granted' | 'denied' | 'unsupported';

/** The parts of `navigator.storage` used here, so tests can pass a stand-in. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

export async function requestPersistentStorage(storage: StorageManagerLike | undefined = globalThis.navigator?.storage): Promise<PersistState> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export const PERSIST_TEXT: Readonly<Record<PersistState, string>> = Object.freeze({
  pending: 'Persistent storage: checking…',
  granted: 'Persistent storage: granted. The browser should not clear these records to free space. Clearing site data still deletes them.',
  denied: 'Persistent storage: not granted. The browser may clear these records when the device is low on space. Export them regularly.',
  unsupported: 'Persistent storage: not available in this browser. It may clear these records when the device is low on space. Export them regularly.',
});

/** localStorage key holding the time of the last "Export all". */
export const LAST_EXPORT_KEY = 'liftwatch.lastExportAt';
export const EXPORT_REMINDER_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Text prompting an export, or null when none is due: there are records and either
 * they have never been exported from this browser, or the last export was
 * `EXPORT_REMINDER_DAYS` or more ago.
 */
export function exportReminder(lastExportAt: string | null, recordCount: number, now: Date = new Date()): string | null {
  if (recordCount === 0) return null;
  const last = lastExportAt ? Date.parse(lastExportAt) : Number.NaN;
  if (!Number.isFinite(last)) return 'These records have not been exported from this browser yet. Export them now and keep the file somewhere safe.';
  const days = Math.floor((now.getTime() - last) / DAY_MS);
  if (days < EXPORT_REMINDER_DAYS) return null;
  return `Last export was ${days} days ago. Export the records now and keep the file somewhere safe.`;
}
