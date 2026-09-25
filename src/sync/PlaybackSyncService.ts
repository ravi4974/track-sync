import type { MediaProvider, PlaybackState } from '../providers/MediaProvider.ts';
import type { PeerLink } from './PeerLink.ts';
import type { ClockSync } from './ClockSync.ts';
import type { PlaybackCommand, PlaybackStreamPayload } from './protocol.ts';
import { nextSeq } from './protocol.ts';

// Narrow surface PlaybackSyncService depends on, so tests can supply a fake instead of a real LeadershipService.
export interface LeadershipView {
  isLeader(): boolean;
  getLeaderId(): string;
}

const MIN_COMMAND_LEAD_MS = 3_000;
const COMMAND_SAFETY_MARGIN_MS = 3_000;
const BROADCAST_POSITION_EPSILON_SEC = 0.5;
const MAX_SEEK_ATTEMPTS = 5;
const STREAM_DRIFT_EPSILON_SEC = 0.3;
const MIN_STREAM_LEAD_MS = 1_000;
const MAX_STREAM_LEAD_MS = 5_000;
const STREAM_LEAD_SAFETY_MARGIN_MS = 300;

export class PlaybackSyncService {
  private applyingRemote = false;
  private lastSeqBySender = new Map<string, number>();
  private lastCommandRevisionBySender = new Map<string, number>();
  private remoteApplyQueue: Promise<void> = Promise.resolve();
  private lastBroadcast: PlaybackState | null = null;
  private commandRevision = 0;
  private isConnected = false;
  private followingLeader = true;
  private latestLeaderStream: PlaybackStreamPayload | null = null;
  private knownPeerIds = new Set<string>();
  private scheduleListeners: Array<(executeAt: number) => void> = [];
  private readonly provider: MediaProvider;
  private readonly connection: PeerLink;
  private readonly clockSync?: ClockSync;
  private readonly leadership?: LeadershipView;
  private readonly now: () => number;

  constructor(
    provider: MediaProvider,
    connection: PeerLink,
    clockSync?: ClockSync,
    now: () => number = Date.now,
    leadership?: LeadershipView,
  ) {
    this.provider = provider;
    this.connection = connection;
    this.clockSync = clockSync;
    this.now = now;
    this.leadership = leadership;
    this.provider.onStateChange((state) => this.broadcastLocalState(state));
    this.provider.onPositionSample((state) => this.broadcastStream(state));
    this.connection.onMessage((message) => {
      if (message.senderId !== this.connection.localId) this.knownPeerIds.add(message.senderId);
      if (message.type === 'PLAYBACK_STATE') {
        if (this.leadership && message.senderId !== this.leaderId()) return;
        const lastSeq = this.lastSeqBySender.get(message.senderId);
        if (lastSeq !== undefined && message.seq <= lastSeq) return;
        this.lastSeqBySender.set(message.senderId, message.seq);
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyRemoteState(message.payload, message.senderId));
      } else if (message.type === 'PLAYBACK_STREAM') {
        if (this.leadership && message.senderId !== this.leaderId()) return;
        const lastSeq = this.lastSeqBySender.get(message.senderId);
        if (lastSeq !== undefined && message.seq <= lastSeq) return;
        this.lastSeqBySender.set(message.senderId, message.seq);
        this.latestLeaderStream = message.payload;
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyLeaderStream(message.payload, message.senderId));
      } else if (message.type === 'PLAYBACK_COMMAND') {
        if (this.leadership && message.senderId !== this.leaderId()) return;
        const lastRevision = this.lastCommandRevisionBySender.get(message.senderId);
        if (lastRevision !== undefined && message.payload.revision <= lastRevision) return;
        this.lastCommandRevisionBySender.set(message.senderId, message.payload.revision);
        if (message.payload.state.isPlaying) {
          for (const listener of this.scheduleListeners) listener(message.payload.executeAt);
        }
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyScheduledCommand(message.payload, message.senderId));
      }
    });
    this.connection.onStatusChange((status) => {
      this.isConnected = status === 'connected';
    });
  }

  isLeader(): boolean {
    return this.leadership ? this.leadership.isLeader() : true;
  }

  async play(): Promise<void> {
    if (!this.isLeader()) {
      this.followingLeader = false;
      await this.provider.play();
      return;
    }
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, isPlaying: true }, true);
  }

  async pause(): Promise<void> {
    if (!this.isLeader()) {
      this.followingLeader = false;
      await this.provider.pause();
      return;
    }
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, isPlaying: false }, true, false);
  }

  async seek(positionSec: number): Promise<void> {
    if (!this.isLeader()) {
      this.followingLeader = false;
      await this.provider.seek(positionSec);
      return;
    }
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, positionSec }, false);
  }

  async load(trackId: string, autoplay = true): Promise<void> {
    if (!this.isLeader()) return; // track changes are a leader-only action
    await this.scheduleLocalCommand({ trackId, isPlaying: autoplay, positionSec: 0, updatedAt: this.now() }, false);
  }

  // Re-arms leader-following and snaps back to the leader's live position; used by the "Sync" button.
  async sync(): Promise<void> {
    this.followingLeader = true;
    if (this.latestLeaderStream) await this.reconcileToStream(this.latestLeaderStream, this.leaderId());
  }

  onScheduledStart(cb: (executeAt: number) => void): void {
    this.scheduleListeners.push(cb);
  }

  private leaderId(): string {
    return this.leadership?.getLeaderId() ?? this.connection.localId;
  }

  private async scheduleLocalCommand(
    state: PlaybackState,
    projectPositionToStart: boolean,
    scheduleForFuture = true,
  ): Promise<void> {
    const executeAt = this.now() + (scheduleForFuture ? this.getCommandLeadMs() : 0);
    const scheduledState = projectPositionToStart
      ? this.projectStateAt(state, executeAt)
      : { ...state, updatedAt: executeAt };
    const command: PlaybackCommand = {
      revision: ++this.commandRevision,
      executeAt,
      state: { ...scheduledState, updatedAt: executeAt },
    };
    if (command.state.isPlaying) {
      for (const listener of this.scheduleListeners) listener(executeAt);
    }
    this.connection.broadcast({
      type: 'PLAYBACK_COMMAND',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: command,
    });
    await this.applyScheduledCommand(command, this.connection.localId);
  }

  private getCommandLeadMs(): number {
    if (!this.isConnected) return 0;
    const measuredRttMs = this.clockSync?.getRttMs() ?? 0;
    return Math.max(MIN_COMMAND_LEAD_MS, measuredRttMs + COMMAND_SAFETY_MARGIN_MS);
  }

  private broadcastLocalState(state: PlaybackState): void {
    if (this.applyingRemote || !this.isLeader()) return; // don't echo state we just applied, or a non-leader's local-only action
    if (this.lastBroadcast && !this.hasMeaningfulChange(this.lastBroadcast, state)) return;
    this.lastBroadcast = state;
    this.connection.broadcast({
      type: 'PLAYBACK_STATE',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: Date.now(),
      payload: state,
    });
  }

  private getStreamLeadMs(): number {
    let maxRttMs = 0;
    for (const peerId of this.knownPeerIds) {
      const rttMs = this.clockSync?.getRttMs(peerId) ?? 0;
      if (rttMs > maxRttMs) maxRttMs = rttMs;
    }
    return Math.min(MAX_STREAM_LEAD_MS, Math.max(MIN_STREAM_LEAD_MS, maxRttMs + STREAM_LEAD_SAFETY_MARGIN_MS));
  }

  private broadcastStream(state: PlaybackState): void {
    if (this.applyingRemote || !state.isPlaying || !this.isLeader()) return;
    const leadMs = this.getStreamLeadMs();
    const currentTs = this.now();
    const payload: PlaybackStreamPayload = {
      trackId: state.trackId,
      isPlaying: state.isPlaying,
      currentPositionSec: state.positionSec,
      currentTs,
      futurePositionSec: state.positionSec + leadMs / 1000,
      futureTs: currentTs + leadMs,
    };
    this.latestLeaderStream = payload;
    this.connection.broadcast({
      type: 'PLAYBACK_STREAM',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: currentTs,
      payload,
    });
  }

  // Backstop against providers that don't dedupe their own no-op state change events.
  private hasMeaningfulChange(previous: PlaybackState, next: PlaybackState): boolean {
    if (previous.trackId !== next.trackId || previous.isPlaying !== next.isPlaying) return true;
    const elapsedSec = previous.isPlaying ? (next.updatedAt - previous.updatedAt) : 0;
    const predicted = (previous.positionSec * 1000 + elapsedSec) / 1000;
    return Math.abs(next.positionSec - predicted) > BROADCAST_POSITION_EPSILON_SEC;
  }

  private async applyRemoteState(remote: PlaybackState, senderId: string): Promise<void> {
    if (!this.followingLeader) return;
    this.applyingRemote = true;
    try {
      const local = this.provider.getState();
      if (remote.trackId && remote.trackId !== local.trackId) {
        await this.provider.load(remote.trackId, false);
        await this.provider.waitUntilReady?.();
      }
      await this.syncPosition(remote, senderId);
      if (remote.isPlaying && !this.provider.getState().isPlaying) {
        await this.provider.play();
        // Loading/buffering time varies per device, so re-check drift once playback has actually started.
        await this.syncPosition(remote, senderId);
      } else if (!remote.isPlaying && this.provider.getState().isPlaying) {
        await this.provider.pause();
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  private async applyLeaderStream(payload: PlaybackStreamPayload, senderId: string): Promise<void> {
    if (!this.followingLeader) return;
    await this.reconcileToStream(payload, senderId);
  }

  // Never pauses to wait for the leader: always seeks/plays toward the predicted leader position.
  private async reconcileToStream(payload: PlaybackStreamPayload, senderId: string): Promise<void> {
    this.applyingRemote = true;
    try {
      const local = this.provider.getState();
      if (payload.trackId && payload.trackId !== local.trackId) {
        await this.provider.load(payload.trackId, false);
        await this.provider.waitUntilReady?.();
      }
      const expected = this.expectedStreamPosition(payload, senderId);
      const current = this.provider.getState().positionSec;
      if (Math.abs(current - expected) > STREAM_DRIFT_EPSILON_SEC) {
        await this.provider.seek(expected);
      }
      if (payload.isPlaying && !this.provider.getState().isPlaying) {
        await this.provider.play();
      } else if (!payload.isPlaying && this.provider.getState().isPlaying) {
        await this.provider.pause();
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  private async applyScheduledCommand(command: PlaybackCommand, senderId: string): Promise<void> {
    this.applyingRemote = true;
    try {
      const offsetMs = senderId === this.connection.localId ? 0 : (this.clockSync?.getOffsetMs(senderId) ?? 0);
      const executeAtLocal = command.executeAt - offsetMs;
      const remote = command.state;
      const local = this.provider.getState();
      if (remote.trackId && remote.trackId !== local.trackId) {
        await this.provider.load(remote.trackId, false);
        await this.provider.waitUntilReady?.();
      }
      await this.syncPosition(remote, senderId);
      await this.waitUntil(executeAtLocal);
      await this.syncPosition(remote, senderId);
      if (remote.isPlaying && !this.provider.getState().isPlaying) {
        await this.provider.play();
        await this.syncPosition(remote, senderId);
      } else if (!remote.isPlaying && this.provider.getState().isPlaying) {
        await this.provider.pause();
        await this.syncPosition(remote, senderId);
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  private projectStateAt(state: PlaybackState, timestamp: number): PlaybackState {
    const elapsedSec = state.isPlaying ? Math.max(0, timestamp - state.updatedAt) / 1000 : 0;
    return { ...state, positionSec: state.positionSec + elapsedSec, updatedAt: timestamp };
  }

  private async waitUntil(timestamp: number): Promise<void> {
    const delayMs = timestamp - this.now();
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  private async syncPosition(remote: PlaybackState, senderId?: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_SEEK_ATTEMPTS; attempt += 1) {
      const expectedPosition = this.expectedPosition(remote, senderId);
      const currentPosition = this.provider.getState().positionSec;
      if (expectedPosition === currentPosition) return;
      await this.provider.seek(expectedPosition);
    }
  }

  private expectedPosition(remote: PlaybackState, senderId?: string): number {
    // The timestamp delta includes message transit time and any local preparation delay.
    const offsetMs = this.clockSync?.getOffsetMs(senderId) ?? 0;
    const remoteUpdatedAtLocal = remote.updatedAt - offsetMs;
    const elapsedSec = remote.isPlaying ? Math.max(0, this.now() - remoteUpdatedAtLocal) / 1000 : 0;
    return remote.positionSec + elapsedSec;
  }

  // Derives the leader's actual playback rate from the two stream anchors, then projects it to "now" -
  // more robust than assuming a fixed 1x rate across a buffering hiccup between samples.
  private expectedStreamPosition(payload: PlaybackStreamPayload, senderId: string): number {
    const offsetMs = this.clockSync?.getOffsetMs(senderId) ?? 0;
    const currentAtLocal = payload.currentTs - offsetMs;
    const futureAtLocal = payload.futureTs - offsetMs;
    const spanMs = futureAtLocal - currentAtLocal;
    const spanPositionSec = payload.futurePositionSec - payload.currentPositionSec;
    const rate = spanMs > 0 ? spanPositionSec / (spanMs / 1000) : (payload.isPlaying ? 1 : 0);
    const elapsedSec = Math.max(0, this.now() - currentAtLocal) / 1000;
    return payload.currentPositionSec + elapsedSec * rate;
  }
}
