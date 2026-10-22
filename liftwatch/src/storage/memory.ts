import type { DecisionRecord } from '../lift/record';
import type { LogEntry } from '../windlog/log';
import { byTime, DuplicateRecordError, newestFirst, type RecordStore } from './types';

/** In-memory store, for tests and as a fallback when IndexedDB is unavailable. */
export class MemoryRecordStore implements RecordStore {
  private readonly records = new Map<string, DecisionRecord>();
  private readonly log = new Map<string, LogEntry>();

  async list(): Promise<DecisionRecord[]> {
    return [...this.records.values()].sort(newestFirst);
  }

  async get(id: string): Promise<DecisionRecord | undefined> {
    return this.records.get(id);
  }

  async add(record: DecisionRecord): Promise<void> {
    if (this.records.has(record.id)) throw new DuplicateRecordError(record.id);
    this.records.set(record.id, record);
  }

  async addLogEntry(entry: LogEntry): Promise<void> {
    if (this.log.has(entry.id)) throw new DuplicateRecordError(entry.id);
    this.log.set(entry.id, entry);
  }

  async listLog(recordId?: string): Promise<LogEntry[]> {
    return [...this.log.values()].filter((e) => !recordId || e.recordId === recordId).sort(byTime);
  }
}
