import { openDB, type IDBPDatabase } from 'idb';

export type LibraryItemKind = 'favorite' | 'playlist' | 'history';

export interface LibraryItem {
  id: string;
  kind: LibraryItemKind;
  trackId: string;
  title?: string;
  playlistName?: string;
  updatedAt: number;
}

const DB_NAME = 'youtube-sync';
const DB_VERSION = 1;
const STORE_NAME = 'libraryItems';

async function openLibraryDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  });
}

export class LibraryStore {
  private dbPromise: Promise<IDBPDatabase>;
  private listeners: Array<() => void> = [];

  constructor(dbName: string = DB_NAME) {
    this.dbPromise = openLibraryDb(dbName);
  }

  async getAll(): Promise<LibraryItem[]> {
    const db = await this.dbPromise;
    return db.getAll(STORE_NAME);
  }

  async put(item: Omit<LibraryItem, 'updatedAt'>): Promise<LibraryItem> {
    const full: LibraryItem = { ...item, updatedAt: Date.now() };
    const db = await this.dbPromise;
    await db.put(STORE_NAME, full);
    this.notify();
    return full;
  }

  async clear(kind: LibraryItemKind): Promise<void> {
    const db = await this.dbPromise;
    const items: LibraryItem[] = await db.getAll(STORE_NAME);
    const ids = items.filter((item) => item.kind === kind).map((item) => item.id);
    if (ids.length === 0) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    await Promise.all(ids.map((id) => transaction.store.delete(id)));
    await transaction.done;
    this.notify();
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
