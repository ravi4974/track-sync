import { describe, expect, it } from 'vitest';
import type { PeerLink } from './PeerLink.ts';
import type { ConnectionStatus } from './PeerConnectionManager.ts';
import type { PeerMessage } from './protocol.ts';
import { ClockSync } from './ClockSync.ts';

class LoopbackLink implements PeerLink {
  readonly localId: string;
  private peer: LoopbackLink | null = null;
  private messageListeners: Array<(message: PeerMessage) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  constructor(localId: string) {
    this.localId = localId;
  }

  linkTo(other: LoopbackLink): void {
    this.peer = other;
  }

  broadcast(message: PeerMessage): void {
    this.peer?.receive(message);
  }

  receive(message: PeerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  onMessage(cb: (message: PeerMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onStatusChange(cb: (status: ConnectionStatus) => void): void {
    this.statusListeners.push(cb);
  }

  emitConnected(): void {
    for (const listener of this.statusListeners) listener('connected');
  }
}

describe('ClockSync', () => {
  it('estimates the offset between two skewed clocks', () => {
    const skewMs = 4000; // peer B's clock is 4s ahead of peer A's
    const linkA = new LoopbackLink('A');
    const linkB = new LoopbackLink('B');
    linkA.linkTo(linkB);
    linkB.linkTo(linkA);

    const baseTime = 1_000_000;
    const clockA = () => baseTime;
    const clockB = () => baseTime + skewMs;

    const clockSyncA = new ClockSync(linkA, clockA);
    new ClockSync(linkB, clockB);

    linkA.emitConnected();

    expect(clockSyncA.getOffsetMs()).toBeCloseTo(skewMs, -1);
  });

  it('defaults to zero offset before any sync has completed', () => {
    const link = new LoopbackLink('A');
    const clockSync = new ClockSync(link);
    expect(clockSync.getOffsetMs()).toBe(0);
  });

  it('defaults to zero rtt before any sync has completed', () => {
    const link = new LoopbackLink('A');
    const clockSync = new ClockSync(link);
    expect(clockSync.getRttMs()).toBe(0);
  });

  it('exposes the best observed rtt after a ping/pong exchange', () => {
    const linkA = new LoopbackLink('A');
    const linkB = new LoopbackLink('B');
    linkA.linkTo(linkB);
    linkB.linkTo(linkA);

    let tick = 1_000_000;
    const advancingClock = () => (tick += 10); // each call moves the clock forward, simulating transit time

    const clockSyncA = new ClockSync(linkA, advancingClock);
    new ClockSync(linkB, advancingClock);

    linkA.emitConnected();

    expect(clockSyncA.getRttMs()).toBeGreaterThan(0);
  });

  it('keeps independent clock estimates for different peers', () => {
    let now = 1_000_100;
    const link = new LoopbackLink('LOCAL');
    const clockSync = new ClockSync(link, () => now);

    link.receive({
      type: 'CLOCK_PONG',
      senderId: 'PEER_A',
      seq: 1,
      ts: now,
      payload: { originTs: 1_000_000, remoteTs: 1_000_150 },
    });
    now += 100;
    link.receive({
      type: 'CLOCK_PONG',
      senderId: 'PEER_B',
      seq: 1,
      ts: now,
      payload: { originTs: 1_000_000, remoteTs: 999_900 },
    });

    expect(clockSync.getOffsetMs('PEER_A')).toBe(100);
    expect(clockSync.getOffsetMs('PEER_B')).toBe(-200);
  });
});
