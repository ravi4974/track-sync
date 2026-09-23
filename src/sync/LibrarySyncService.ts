import type { PeerLink } from './PeerLink.ts';
import type { PeerMessage } from './protocol.ts';
import { nextSeq } from './protocol.ts';
import type { LibraryStore, LibraryItem } from '../storage/LibraryStore.ts';

export class LibrarySyncService {
  private readonly store: LibraryStore;
  private readonly connection: PeerLink;

  constructor(store: LibraryStore, connection: PeerLink) {
    this.store = store;
    this.connection = connection;
    this.connection.onStatusChange((status) => {
      if (status === 'connected') this.requestSync();
    });
    this.connection.onMessage((message) => void this.handleMessage(message));
  }

  private requestSync(): void {
    this.connection.broadcast({
      type: 'LIBRARY_SYNC_REQUEST',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: Date.now(),
    });
  }

  private async handleMessage(message: PeerMessage): Promise<void> {
    if (message.type === 'LIBRARY_SYNC_REQUEST') {
      const items = await this.store.getAll();
      this.connection.broadcast({
        type: 'LIBRARY_SNAPSHOT',
        senderId: this.connection.localId,
        seq: nextSeq(),
        ts: Date.now(),
        payload: items,
      });
    } else if (message.type === 'LIBRARY_SNAPSHOT') {
      for (const item of message.payload) await this.store.merge(item);
    } else if (message.type === 'LIBRARY_DELTA') {
      await this.store.merge(message.payload);
    }
  }

  /** Call after a local mutation to propagate it to connected peers. */
  broadcastLocalChange(item: LibraryItem): void {
    this.connection.broadcast({
      type: 'LIBRARY_DELTA',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: Date.now(),
      payload: item,
    });
  }
}
