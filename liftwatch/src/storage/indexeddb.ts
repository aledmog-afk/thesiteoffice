import type { DecisionRecord } from '../lift/record';
import { MemoryRecordStore } from './memory';
import { DuplicateRecordError, newestFirst, type RecordStore } from './types';

const DB_NAME = 'liftwatch';
const DB_VERSION = 1;
const STORE = 'records';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Records kept in this browser's IndexedDB. Clearing site data deletes them: export regularly. */
export class IndexedDbRecordStore implements RecordStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.db;
  }

  async list(): Promise<DecisionRecord[]> {
    const db = await this.open();
    const all = await promisify(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return (all as DecisionRecord[]).sort(newestFirst);
  }

  async get(id: string): Promise<DecisionRecord | undefined> {
    const db = await this.open();
    return (await promisify(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as DecisionRecord | undefined;
  }

  async add(record: DecisionRecord): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    try {
      // add() (not put()) fails if the id exists, so a saved record is never overwritten.
      await promisify(tx.objectStore(STORE).add(record));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'ConstraintError') throw new DuplicateRecordError(record.id);
      throw err;
    }
  }
}

/** IndexedDB when available, otherwise memory (records then last only until the tab closes). */
export function createDefaultStore(): { store: RecordStore; persistent: boolean } {
  if (typeof indexedDB !== 'undefined') return { store: new IndexedDbRecordStore(), persistent: true };
  return { store: new MemoryRecordStore(), persistent: false };
}

