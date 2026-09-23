import { openDB, type IDBPDatabase } from 'idb';

export type LibraryItemKind = 'favorite' | 'playlist' | 'history';

export interface LibraryItem {
  id: string;
  kind: LibraryItemKind;
  trackId: string;
  title?: string;
  playlistName?: string;
  updatedAt: number;
  deletedAt?: number | null;
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
    const items: LibraryItem[] = await db.getAll(STORE_NAME);
    return items.filter((item) => !item.deletedAt);
  }

  /** Writes a local change and returns it with a fresh updatedAt, ready to broadcast. */
  async put(item: Omit<LibraryItem, 'updatedAt'>): Promise<LibraryItem> {
    const full: LibraryItem = { ...item, updatedAt: Date.now() };
    const db = await this.dbPromise;
    await db.put(STORE_NAME, full);
    this.notify();
    return full;
  }

  /** Applies a remote item using last-write-wins; returns true if it was applied. */
  async merge(remote: LibraryItem): Promise<boolean> {
    const db = await this.dbPromise;
    const local: LibraryItem | undefined = await db.get(STORE_NAME, remote.id);
    if (local && local.updatedAt >= remote.updatedAt) return false;
    await db.put(STORE_NAME, remote);
    this.notify();
    return true;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
