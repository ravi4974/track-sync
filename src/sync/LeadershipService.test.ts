import { describe, expect, it, vi } from 'vitest';
import type { RoomLink } from './PeerLink.ts';
import type { PeerMessage } from './protocol.ts';
import { LeadershipService } from './LeadershipService.ts';

class FakeRoomLink implements RoomLink {
  readonly localId: string;
  readonly sent: PeerMessage[] = [];
  readonly connectedTo: string[] = [];
  readonly disconnectedFrom: string[] = [];
  private connectedPeerIds: string[];
  private messageListeners: Array<(message: PeerMessage) => void> = [];

  constructor(localId: string, connectedPeerIds: string[] = []) {
    this.localId = localId;
    this.connectedPeerIds = connectedPeerIds;
  }

  broadcast(message: PeerMessage): void {
    this.sent.push(message);
  }

  onMessage(cb: (message: PeerMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onStatusChange(): void {
    // not needed for these tests
  }

  connectTo(remoteId: string): void {
    this.connectedTo.push(remoteId);
    this.connectedPeerIds.push(remoteId);
  }

  disconnectFrom(peerId: string): void {
    this.disconnectedFrom.push(peerId);
    this.connectedPeerIds = this.connectedPeerIds.filter((id) => id !== peerId);
  }

  getConnectedPeerIds(): string[] {
    return [...this.connectedPeerIds];
  }

  simulateIncoming(message: PeerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

describe('LeadershipService', () => {
  it('is the leader of itself by default', () => {
    const link = new FakeRoomLink('LOCAL1');
    const leadership = new LeadershipService(link);

    expect(leadership.isLeader()).toBe(true);
    expect(leadership.getLeaderId()).toBe('LOCAL1');
  });

  it('sends a transfer request and does nothing if already leader', () => {
    const link = new FakeRoomLink('LOCAL1');
    const leadership = new LeadershipService(link);

    leadership.requestLeadership();

    expect(link.sent).toHaveLength(0);
  });

  it('auto-approves an incoming request once the countdown expires', () => {
    vi.useFakeTimers();
    const link = new FakeRoomLink('LEADER1', ['SPOKE1']);
    const leadership = new LeadershipService(link);
    leadership.setRequestTimeoutSec(10);

    link.simulateIncoming({ type: 'LEADER_TRANSFER_REQUEST', senderId: 'SPOKE1', seq: 1, ts: Date.now() });
    vi.advanceTimersByTime(10_000);

    expect(link.sent).toContainEqual(expect.objectContaining({
      type: 'LEADER_TRANSFER_RESPONSE',
      payload: { requesterId: 'SPOKE1', approved: true },
    }));
    expect(leadership.isLeader()).toBe(false);
    expect(leadership.getLeaderId()).toBe('SPOKE1');
    vi.useRealTimers();
  });

  it('denies immediately without waiting for the countdown', () => {
    const link = new FakeRoomLink('LEADER1', ['SPOKE1']);
    const leadership = new LeadershipService(link);

    link.simulateIncoming({ type: 'LEADER_TRANSFER_REQUEST', senderId: 'SPOKE1', seq: 1, ts: Date.now() });
    leadership.denyIncomingRequest();

    expect(link.sent).toContainEqual(expect.objectContaining({
      type: 'LEADER_TRANSFER_RESPONSE',
      payload: { requesterId: 'SPOKE1', approved: false },
    }));
    expect(leadership.isLeader()).toBe(true);
  });

  it('auto-denies immediately when do-not-disturb is enabled', () => {
    const link = new FakeRoomLink('LEADER1', ['SPOKE1']);
    const leadership = new LeadershipService(link);
    leadership.setDoNotDisturb(true);

    link.simulateIncoming({ type: 'LEADER_TRANSFER_REQUEST', senderId: 'SPOKE1', seq: 1, ts: Date.now() });

    expect(link.sent).toContainEqual(expect.objectContaining({
      type: 'LEADER_TRANSFER_RESPONSE',
      payload: { requesterId: 'SPOKE1', approved: false },
    }));
    expect(leadership.isLeader()).toBe(true);
  });

  it('disconnects other spokes and keeps the new leader link when approving a transfer', () => {
    const link = new FakeRoomLink('LEADER1', ['SPOKE1', 'SPOKE2']);
    const leadership = new LeadershipService(link);

    link.simulateIncoming({ type: 'LEADER_TRANSFER_REQUEST', senderId: 'SPOKE1', seq: 1, ts: Date.now() });
    leadership.approveIncomingRequest();

    expect(link.disconnectedFrom).toEqual(['SPOKE2']);
    expect(leadership.isLeader()).toBe(false);
    expect(leadership.getLeaderId()).toBe('SPOKE1');
  });

  it('becomes leader when the requester receives an approval response', () => {
    const link = new FakeRoomLink('SPOKE1');
    const leadership = new LeadershipService(link);
    leadership.joinLeader('LEADER1');

    leadership.requestLeadership();
    link.simulateIncoming({
      type: 'LEADER_TRANSFER_RESPONSE',
      senderId: 'LEADER1',
      seq: 1,
      ts: Date.now(),
      payload: { requesterId: 'SPOKE1', approved: true },
    });

    expect(leadership.isLeader()).toBe(true);
  });

  it('notifies the requester when denied', () => {
    const link = new FakeRoomLink('SPOKE1');
    const leadership = new LeadershipService(link);
    leadership.joinLeader('LEADER1');
    const outcomes: string[] = [];
    leadership.onRequestResolved((outcome) => outcomes.push(outcome));

    leadership.requestLeadership();
    link.simulateIncoming({
      type: 'LEADER_TRANSFER_RESPONSE',
      senderId: 'LEADER1',
      seq: 1,
      ts: Date.now(),
      payload: { requesterId: 'SPOKE1', approved: false },
    });

    expect(outcomes).toEqual(['denied']);
    expect(leadership.isLeader()).toBe(false);
  });

  it('re-parents an uninvolved spoke to the new leader on LEADER_CHANGED', () => {
    const link = new FakeRoomLink('SPOKE2', ['LEADER1']);
    const leadership = new LeadershipService(link);
    leadership.joinLeader('LEADER1');

    link.simulateIncoming({
      type: 'LEADER_CHANGED',
      senderId: 'LEADER1',
      seq: 1,
      ts: Date.now(),
      payload: { leaderId: 'SPOKE1' },
    });

    expect(link.disconnectedFrom).toEqual(['LEADER1']);
    expect(link.connectedTo).toEqual(['SPOKE1']);
    expect(leadership.getLeaderId()).toBe('SPOKE1');
  });

  it('expires an outgoing request if no response ever arrives', () => {
    vi.useFakeTimers();
    const link = new FakeRoomLink('SPOKE1');
    const leadership = new LeadershipService(link);
    leadership.joinLeader('LEADER1');
    const outcomes: string[] = [];
    leadership.onRequestResolved((outcome) => outcomes.push(outcome));

    leadership.requestLeadership();
    vi.advanceTimersByTime(20_000);

    expect(outcomes).toEqual(['expired']);
    vi.useRealTimers();
  });
});
