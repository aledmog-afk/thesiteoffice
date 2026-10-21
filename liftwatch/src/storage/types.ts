import type { DecisionRecord } from '../lift/record';

/**
 * Where decision records live. The pilot keeps them on the device (IndexedDB).
 * A Supabase implementation can replace it later without touching the screens.
 * Records are append-only: there is no update method.
 */
export interface RecordStore {
  /** Newest first. */
  list(): Promise<DecisionRecord[]>;
  get(id: string): Promise<DecisionRecord | undefined>;
  /** Rejects with DuplicateRecordError if a record with the same id exists. */
  add(record: DecisionRecord): Promise<void>;
}

export class DuplicateRecordError extends Error {
  constructor(id: string) {
    super(`A record with id ${id} already exists.`);
    this.name = 'DuplicateRecordError';
  }
}

export function newestFirst(a: DecisionRecord, b: DecisionRecord): number {
  return b.createdAt.localeCompare(a.createdAt);
}
