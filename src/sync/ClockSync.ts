import type { PeerLink } from './PeerLink.ts';
import type { PeerMessage } from './protocol.ts';
import { nextSeq } from './protocol.ts';

const RESYNC_INTERVAL_MS = 30_000;
const SAMPLE_COUNT = 3;

interface ClockEstimate {
  offsetMs: number;
  bestRttMs: number;
}

/**
 * Estimates the (remoteClock - localClock) offset via an NTP-style ping/pong exchange, so that
 * playback timestamps from a peer with a differently-set system clock can still be compared fairly.
 */
export class ClockSync {
  private offsetMs = 0;
  private bestRttMs = Infinity;
  private estimatesByPeer = new Map<string, ClockEstimate>();
  private readonly connection: PeerLink;
  private readonly now: () => number;

  constructor(connection: PeerLink, now: () => number = Date.now) {
    this.connection = connection;
    this.now = now;
    this.connection.onMessage((message) => this.handleMessage(message));
    this.connection.onStatusChange((status) => {
      if (status === 'connected') this.startSync();
    });
  }

  getOffsetMs(peerId?: string): number {
    return peerId ? (this.estimatesByPeer.get(peerId)?.offsetMs ?? 0) : this.offsetMs;
  }

  getRttMs(peerId?: string): number {
    const rttMs = peerId ? this.estimatesByPeer.get(peerId)?.bestRttMs : this.bestRttMs;
    return rttMs !== undefined && Number.isFinite(rttMs) ? rttMs : 0;
  }

  private startSync(): void {
    this.bestRttMs = Infinity;
    for (let i = 0; i < SAMPLE_COUNT; i++) this.sendPing();
    setInterval(() => this.sendPing(), RESYNC_INTERVAL_MS);
  }

  private sendPing(): void {
    this.connection.broadcast({
      type: 'CLOCK_PING',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: { originTs: this.now() },
    });
  }

  private handleMessage(message: PeerMessage): void {
    if (message.type === 'CLOCK_PING') {
      this.connection.broadcast({
        type: 'CLOCK_PONG',
        senderId: this.connection.localId,
        seq: nextSeq(),
        ts: this.now(),
        payload: { originTs: message.payload.originTs, remoteTs: this.now() },
      });
    } else if (message.type === 'CLOCK_PONG') {
      const destinationTs = this.now();
      const rtt = destinationTs - message.payload.originTs;
      // Lower RTT samples give a tighter, more reliable offset estimate.
      const estimate = this.estimatesByPeer.get(message.senderId);
      if (!estimate || rtt < estimate.bestRttMs) {
        const offsetMs = message.payload.remoteTs - (message.payload.originTs + destinationTs) / 2;
        this.estimatesByPeer.set(message.senderId, { offsetMs, bestRttMs: rtt });
        this.offsetMs = offsetMs;
      }
      if (rtt < this.bestRttMs) {
        this.bestRttMs = rtt;
      }
    }
  }
}
