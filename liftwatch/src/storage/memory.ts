import type { DecisionRecord } from '../lift/record';
import { DuplicateRecordError, newestFirst, type RecordStore } from './types';

/** In-memory store, for tests and as a fallback when IndexedDB is unavailable. */
export class MemoryRecordStore implements RecordStore {
  private readonly records = new Map<string, DecisionRecord>();

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
}
