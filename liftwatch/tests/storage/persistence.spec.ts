import { describe, expect, it } from 'vitest';
import { INTEGRITY_NOTE } from '../../src/lift/record';
import { EXPORT_REMINDER_DAYS, exportReminder, PERSIST_TEXT, requestPersistentStorage } from '../../src/storage/persistence';

describe('requestPersistentStorage', () => {
  it('reports granted when the browser agrees', async () => {
    let asked = 0;
    const storage = { persisted: async () => false, persist: async () => (asked++, true) };
    expect(await requestPersistentStorage(storage)).toBe('granted');
    expect(asked).toBe(1);
  });

  it('does not ask again when storage is already persistent', async () => {
    let asked = 0;
    expect(await requestPersistentStorage({ persisted: async () => true, persist: async () => (asked++, true) })).toBe('granted');
    expect(asked).toBe(0);
  });

  it('reports denied when the browser refuses or throws', async () => {
    expect(await requestPersistentStorage({ persist: async () => false })).toBe('denied');
    expect(await requestPersistentStorage({ persist: async () => Promise.reject(new Error('no')) })).toBe('denied');
  });

  it('reports unsupported without the API', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });

  it('has text for every answer, warning when not granted', () => {
    expect(PERSIST_TEXT.granted).toMatch(/^Persistent storage: granted/);
    expect(PERSIST_TEXT.denied).toMatch(/not granted.*Export/);
    expect(PERSIST_TEXT.unsupported).toMatch(/not available.*Export/);
  });
});

describe('exportReminder', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it('is quiet with no records', () => {
    expect(exportReminder(null, 0, now)).toBeNull();
  });

  it('prompts when records have never been exported', () => {
    expect(exportReminder(null, 3, now)).toMatch(/not been exported/);
    expect(exportReminder('not a date', 3, now)).toMatch(/not been exported/);
  });

  it('is quiet within 7 days of the last export', () => {
    expect(EXPORT_REMINDER_DAYS).toBe(7);
    expect(exportReminder(daysAgo(0), 3, now)).toBeNull();
    expect(exportReminder(daysAgo(6.9), 3, now)).toBeNull();
  });

  it('prompts from 7 days after the last export', () => {
    expect(exportReminder(daysAgo(7), 3, now)).toBe('Last export was 7 days ago. Export the records now and keep the file somewhere safe.');
    expect(exportReminder(daysAgo(30), 1, now)).toMatch(/30 days ago/);
  });
});

describe('record protection wording', () => {
  it('describes an integrity check, never a lock', () => {
    expect(INTEGRITY_NOTE).toMatch(/^A timestamped record with an integrity check that detects accidental changes\./);
    expect(INTEGRITY_NOTE).toMatch(/not tamper-proof/);
  });

  it('nothing a user sees calls records locked or tamper-proof', () => {
    const sources = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [f, text] of Object.entries(sources)) {
      const strings = text.match(/(['`"])(?:(?!\1).)*\1/g) ?? [];
      for (const s of strings) {
        expect(/\blocked\b|read-only|cannot be edited/i.test(s), `${f}: ${s}`).toBe(false);
        if (/tamper-proof/i.test(s)) expect(s, f).toMatch(/not tamper-proof/);
      }
    }
  });
});
