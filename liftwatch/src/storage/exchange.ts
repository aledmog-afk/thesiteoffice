import { APP_NAME } from '../config';
import { verifyRecord, type DecisionRecord } from '../lift/record';
import type { LogEntry } from '../windlog/log';
import { DuplicateRecordError, type RecordStore } from './types';

export const EXPORT_FORMAT = 'liftwatch-records';
export const EXPORT_VERSION = 1;

export interface RecordExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  app: string;
  exportedAt: string;
  records: DecisionRecord[];
  /** Lift-day wind log entries. Absent in files exported before the log existed. */
  windLog?: LogEntry[];
}

export async function exportRecords(store: RecordStore, now: Date = new Date()): Promise<string> {
  const file: RecordExport = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    app: APP_NAME,
    exportedAt: now.toISOString(),
    records: await store.list(),
    windLog: await store.listLog(),
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  added: number;
  skippedExisting: number;
  logEntriesAdded: number;
  rejected: { id: string; reason: string }[];
}

/**
 * Adds records from an export file. Existing ids are skipped, never overwritten.
 * A record whose integrity hash does not match its content is rejected.
 */
export async function importRecords(store: RecordStore, json: string): Promise<ImportResult> {
  let file: Partial<RecordExport>;
  try {
    file = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (file.format !== EXPORT_FORMAT || !Array.isArray(file.records)) {
    throw new Error(`The file is not a ${APP_NAME} records export.`);
  }
  if (file.version !== EXPORT_VERSION) throw new Error(`Unsupported export version ${String(file.version)}.`);

  const result: ImportResult = { added: 0, skippedExisting: 0, logEntriesAdded: 0, rejected: [] };
  for (const record of file.records) {
    const id = typeof record?.id === 'string' ? record.id : '(no id)';
    if (!record || typeof record !== 'object' || typeof record.integrity !== 'string' || record.schema !== 1) {
      result.rejected.push({ id, reason: 'Not a decision record.' });
      continue;
    }
    if (!(await verifyRecord(record))) {
      result.rejected.push({ id, reason: 'Content does not match its integrity hash (edited after saving).' });
      continue;
    }
    try {
      await store.add(record);
      result.added++;
    } catch (err) {
      if (err instanceof DuplicateRecordError) result.skippedExisting++;
      else throw err;
    }
  }
  for (const entry of Array.isArray(file.windLog) ? file.windLog : []) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.recordId !== 'string' || typeof entry.at !== 'string') continue;
    try {
      await store.addLogEntry(entry);
      result.logEntriesAdded++;
    } catch (err) {
      if (!(err instanceof DuplicateRecordError)) throw err;
    }
  }
  return result;
}
