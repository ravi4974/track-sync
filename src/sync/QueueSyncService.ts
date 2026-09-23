import type { PlaybackQueue } from '../queue/PlaybackQueue.ts';
import type { PeerLink } from './PeerLink.ts';
import type { PeerMessage, QueueSnapshot } from './protocol.ts';
import { nextSeq } from './protocol.ts';

export class QueueSyncService {
  private readonly queue: PlaybackQueue;
  private readonly connection: PeerLink;
  private updatedAt = 0;
  private updatedBy = '';
  private applyingRemoteUpdate = false;

  constructor(queue: PlaybackQueue, connection: PeerLink) {
    this.queue = queue;
    this.connection = connection;
    this.queue.onChange(() => this.handleLocalChange());
    this.connection.onStatusChange((status) => {
      if (status === 'connected') this.requestSync();
    });
    this.connection.onMessage((message) => this.handleMessage(message));
  }

  private handleLocalChange(): void {
    if (this.applyingRemoteUpdate) return;
    this.updatedAt = Date.now();
    this.updatedBy = this.connection.localId;
    this.broadcastSnapshot();
  }

  private requestSync(): void {
    this.connection.broadcast({
      type: 'QUEUE_SYNC_REQUEST',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: Date.now(),
    });
  }

  private broadcastSnapshot(): void {
    const payload: QueueSnapshot = {
      items: this.queue.queue.map((item) => ({ ...item })),
      updatedAt: this.updatedAt,
    };
    this.connection.broadcast({
      type: 'QUEUE_SNAPSHOT',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: Date.now(),
      payload,
    });
  }

  private handleMessage(message: PeerMessage): void {
    if (message.type === 'QUEUE_SYNC_REQUEST') {
      if (this.updatedAt > 0) this.broadcastSnapshot();
      return;
    }
    if (message.type !== 'QUEUE_SNAPSHOT') return;
    if (!this.isNewer(message.payload.updatedAt, message.senderId)) return;
    this.updatedAt = message.payload.updatedAt;
    this.updatedBy = message.senderId;
    this.applyingRemoteUpdate = true;
    this.queue.replace(message.payload.items);
    this.applyingRemoteUpdate = false;
  }

  private isNewer(updatedAt: number, senderId: string): boolean {
    return updatedAt > this.updatedAt || (updatedAt === this.updatedAt && senderId > this.updatedBy);
  }
}