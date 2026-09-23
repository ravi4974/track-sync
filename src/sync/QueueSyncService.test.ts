import { describe, expect, it } from 'vitest';
import { PlaybackQueue } from '../queue/PlaybackQueue.ts';
import type { PeerLink } from './PeerLink.ts';
import type { ConnectionStatus } from './PeerConnectionManager.ts';
import type { PeerMessage } from './protocol.ts';
import { QueueSyncService } from './QueueSyncService.ts';

class FakePeerLink implements PeerLink {
  readonly localId: string;
  readonly sent: PeerMessage[] = [];
  private messageListeners: Array<(message: PeerMessage) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  constructor(localId: string) {
    this.localId = localId;
  }

  broadcast(message: PeerMessage): void { this.sent.push(message); }
  onMessage(cb: (message: PeerMessage) => void): void { this.messageListeners.push(cb); }
  onStatusChange(cb: (status: ConnectionStatus) => void): void { this.statusListeners.push(cb); }
  receive(message: PeerMessage): void { for (const listener of this.messageListeners) listener(message); }
  setStatus(status: ConnectionStatus): void { for (const listener of this.statusListeners) listener(status); }
}

describe('QueueSyncService', () => {
  it('broadcasts a snapshot for a local queue change', () => {
    const queue = new PlaybackQueue();
    const link = new FakePeerLink('LOCAL1');
    new QueueSyncService(queue, link);

    queue.add('track-a', 'item-a');

    expect(link.sent[0]).toMatchObject({ type: 'QUEUE_SNAPSHOT', payload: { items: [{ id: 'item-a', trackId: 'track-a' }] } });
  });

  it('applies a newer remote snapshot without echoing it back', () => {
    const queue = new PlaybackQueue();
    const link = new FakePeerLink('LOCAL1');
    new QueueSyncService(queue, link);

    link.receive({ type: 'QUEUE_SNAPSHOT', senderId: 'REMOTE', seq: 1, ts: 100, payload: { updatedAt: 100, items: [{ id: 'item-a', trackId: 'track-a' }] } });

    expect(queue.queue).toEqual([{ id: 'item-a', trackId: 'track-a' }]);
    expect(link.sent).toHaveLength(0);
  });

  it('responds to a sync request only after a local change', () => {
    const queue = new PlaybackQueue();
    const link = new FakePeerLink('LOCAL1');
    new QueueSyncService(queue, link);

    link.receive({ type: 'QUEUE_SYNC_REQUEST', senderId: 'REMOTE', seq: 1, ts: 1 });
    expect(link.sent).toHaveLength(0);

    queue.add('track-a', 'item-a');
    link.receive({ type: 'QUEUE_SYNC_REQUEST', senderId: 'REMOTE', seq: 2, ts: 2 });
    expect(link.sent.filter((message) => message.type === 'QUEUE_SNAPSHOT')).toHaveLength(2);
  });
});