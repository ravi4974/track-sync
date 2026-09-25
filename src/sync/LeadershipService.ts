import type { RoomLink } from './PeerLink.ts';
import type { PeerMessage } from './protocol.ts';
import { nextSeq } from './protocol.ts';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
// Requester doesn't know the leader's configured timeout, so it gives up after a generous fallback.
const REQUESTER_FALLBACK_TIMEOUT_MS = 20_000;

export type LeadershipRequestOutcome = 'approved' | 'denied' | 'expired';

export interface IncomingLeadershipRequest {
  requesterId: string;
  deadline: number;
}

export class LeadershipService {
  private leaderId: string;
  private requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  private dnd = false;
  private pendingIncoming: IncomingLeadershipRequest | null = null;
  private pendingIncomingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOutgoing = false;
  private readonly connection: RoomLink;
  private readonly now: () => number;
  private leaderChangeListeners: Array<(leaderId: string) => void> = [];
  private incomingRequestListeners: Array<(request: IncomingLeadershipRequest) => void> = [];
  private incomingRequestClearedListeners: Array<() => void> = [];
  private requestResolvedListeners: Array<(outcome: LeadershipRequestOutcome) => void> = [];

  constructor(connection: RoomLink, now: () => number = Date.now) {
    this.connection = connection;
    this.now = now;
    this.leaderId = connection.localId;
    this.connection.onMessage((message) => this.handleMessage(message));
  }

  isLeader(): boolean {
    return this.leaderId === this.connection.localId;
  }

  getLeaderId(): string {
    return this.leaderId;
  }

  // Call after connectTo(remoteId): the device you join becomes your leader until a transfer occurs.
  joinLeader(remoteId: string): void {
    this.setLeader(remoteId.trim().toUpperCase());
  }

  setRequestTimeoutSec(seconds: number): void {
    this.requestTimeoutMs = Math.max(1, seconds) * 1000;
  }

  setDoNotDisturb(enabled: boolean): void {
    this.dnd = enabled;
  }

  onLeaderChange(cb: (leaderId: string) => void): void {
    this.leaderChangeListeners.push(cb);
  }

  onIncomingRequest(cb: (request: IncomingLeadershipRequest) => void): void {
    this.incomingRequestListeners.push(cb);
  }

  onIncomingRequestCleared(cb: () => void): void {
    this.incomingRequestClearedListeners.push(cb);
  }

  onRequestResolved(cb: (outcome: LeadershipRequestOutcome) => void): void {
    this.requestResolvedListeners.push(cb);
  }

  requestLeadership(): void {
    if (this.isLeader() || this.pendingOutgoing) return;
    this.pendingOutgoing = true;
    this.connection.broadcast({
      type: 'LEADER_TRANSFER_REQUEST',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
    });
    setTimeout(() => {
      if (!this.pendingOutgoing) return;
      this.pendingOutgoing = false;
      for (const listener of this.requestResolvedListeners) listener('expired');
    }, REQUESTER_FALLBACK_TIMEOUT_MS);
  }

  approveIncomingRequest(): void {
    if (!this.pendingIncoming) return;
    this.resolveIncomingRequest(this.pendingIncoming.requesterId, true);
  }

  denyIncomingRequest(): void {
    if (!this.pendingIncoming) return;
    this.resolveIncomingRequest(this.pendingIncoming.requesterId, false);
  }

  private handleMessage(message: PeerMessage): void {
    if (message.type === 'LEADER_TRANSFER_REQUEST') {
      this.handleIncomingRequest(message.senderId);
    } else if (message.type === 'LEADER_TRANSFER_RESPONSE') {
      this.handleResponse(message.payload.requesterId, message.payload.approved);
    } else if (message.type === 'LEADER_CHANGED') {
      this.handleLeaderChanged(message.payload.leaderId);
    }
  }

  private handleIncomingRequest(requesterId: string): void {
    if (!this.isLeader() || this.pendingIncoming) return;
    if (this.dnd) {
      this.sendResponse(requesterId, false);
      return;
    }
    const deadline = this.now() + this.requestTimeoutMs;
    this.pendingIncoming = { requesterId, deadline };
    this.pendingIncomingTimer = setTimeout(() => this.resolveIncomingRequest(requesterId, true), this.requestTimeoutMs);
    for (const listener of this.incomingRequestListeners) listener(this.pendingIncoming);
  }

  private resolveIncomingRequest(requesterId: string, approved: boolean): void {
    if (this.pendingIncomingTimer !== null) {
      clearTimeout(this.pendingIncomingTimer);
      this.pendingIncomingTimer = null;
    }
    this.pendingIncoming = null;
    for (const listener of this.incomingRequestClearedListeners) listener();
    this.sendResponse(requesterId, approved);
    if (approved) this.becomeSpokeOf(requesterId);
  }

  private sendResponse(requesterId: string, approved: boolean): void {
    this.connection.broadcast({
      type: 'LEADER_TRANSFER_RESPONSE',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: { requesterId, approved },
    });
    if (approved) this.broadcastLeaderChanged(requesterId);
  }

  private handleResponse(requesterId: string, approved: boolean): void {
    if (requesterId !== this.connection.localId || !this.pendingOutgoing) return;
    this.pendingOutgoing = false;
    if (approved) {
      this.setLeader(this.connection.localId);
    }
    for (const listener of this.requestResolvedListeners) listener(approved ? 'approved' : 'denied');
  }

  private handleLeaderChanged(newLeaderId: string): void {
    const previousLeaderId = this.leaderId;
    if (newLeaderId === previousLeaderId) return;
    this.setLeader(newLeaderId);
    if (newLeaderId === this.connection.localId) return; // I initiated this and already reconciled myself.
    if (previousLeaderId !== this.connection.localId) {
      // I was a spoke of the old leader; re-parent to the new one.
      this.connection.disconnectFrom(previousLeaderId);
      this.connection.connectTo(newLeaderId);
    }
  }

  // Called on the old leader once it approves a transfer, so it relays the change to its other spokes.
  private becomeSpokeOf(newLeaderId: string): void {
    this.setLeader(newLeaderId);
    for (const peerId of this.connection.getConnectedPeerIds()) {
      if (peerId !== newLeaderId) this.connection.disconnectFrom(peerId);
    }
  }

  private broadcastLeaderChanged(leaderId: string): void {
    this.connection.broadcast({
      type: 'LEADER_CHANGED',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: { leaderId },
    });
  }

  private setLeader(leaderId: string): void {
    if (this.leaderId === leaderId) return;
    this.leaderId = leaderId;
    for (const listener of this.leaderChangeListeners) listener(leaderId);
  }
}
