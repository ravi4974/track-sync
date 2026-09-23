import type { MediaProvider, PlaybackState } from '../providers/MediaProvider.ts';
import type { PeerLink } from './PeerLink.ts';
import type { ClockSync } from './ClockSync.ts';
import type { PlaybackCommand } from './protocol.ts';
import { nextSeq } from './protocol.ts';

const BROADCAST_POSITION_EPSILON_SEC = 0.5;
const MAX_SEEK_ATTEMPTS = 5;
const COMMAND_LEAD_MS = 1_500;
const HOLD_FOR_CATCH_UP_DRIFT_SEC = 0.1;
const RESUME_POSITION_TOLERANCE_SEC = 0.005;

interface CatchUpHold {
  senderId: string;
  trackId: string | null;
  resumeAtPositionSec: number;
}

export class PlaybackSyncService {
  private applyingRemote = false;
  private lastSeqBySender = new Map<string, number>();
  private lastCommandRevisionBySender = new Map<string, number>();
  private remoteApplyQueue: Promise<void> = Promise.resolve();
  private lastBroadcast: PlaybackState | null = null;
  private commandRevision = 0;
  private isConnected = false;
  private catchUpHold: CatchUpHold | null = null;
  private readonly provider: MediaProvider;
  private readonly connection: PeerLink;
  private readonly clockSync?: ClockSync;
  private readonly now: () => number;

  constructor(provider: MediaProvider, connection: PeerLink, clockSync?: ClockSync, now: () => number = Date.now) {
    this.provider = provider;
    this.connection = connection;
    this.clockSync = clockSync;
    this.now = now;
    this.provider.onStateChange((state) => this.broadcastLocalState(state));
    this.provider.onPositionSample((state) => this.broadcastPositionProbe(state));
    this.connection.onMessage((message) => {
      if (message.type === 'PLAYBACK_STATE') {
        const lastSeq = this.lastSeqBySender.get(message.senderId);
        if (lastSeq !== undefined && message.seq <= lastSeq) return;
        this.lastSeqBySender.set(message.senderId, message.seq);
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyRemoteState(message.payload, message.senderId));
      } else if (message.type === 'PLAYBACK_PROBE') {
        const lastSeq = this.lastSeqBySender.get(message.senderId);
        if (lastSeq !== undefined && message.seq <= lastSeq) return;
        this.lastSeqBySender.set(message.senderId, message.seq);
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyPositionProbe(message.payload, message.senderId));
      } else if (message.type === 'PLAYBACK_COMMAND') {
        const lastRevision = this.lastCommandRevisionBySender.get(message.senderId);
        if (lastRevision !== undefined && message.payload.revision <= lastRevision) return;
        this.lastCommandRevisionBySender.set(message.senderId, message.payload.revision);
        this.remoteApplyQueue = this.remoteApplyQueue.then(() => this.applyScheduledCommand(message.payload, message.senderId));
      }
    });
    this.connection.onStatusChange((status) => {
      this.isConnected = status === 'connected';
    });
  }

  async play(): Promise<void> {
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, isPlaying: true });
  }

  async pause(): Promise<void> {
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, isPlaying: false });
  }

  async seek(positionSec: number): Promise<void> {
    const state = this.projectStateAt(this.provider.getState(), this.now());
    await this.scheduleLocalCommand({ ...state, positionSec });
  }

  async load(trackId: string, autoplay = true): Promise<void> {
    await this.scheduleLocalCommand({ trackId, isPlaying: autoplay, positionSec: 0, updatedAt: this.now() });
  }

  private async scheduleLocalCommand(state: PlaybackState): Promise<void> {
    const executeAt = this.now() + (this.isConnected ? COMMAND_LEAD_MS : 0);
    const command: PlaybackCommand = {
      revision: ++this.commandRevision,
      executeAt,
      state: { ...state, updatedAt: executeAt },
    };
    this.connection.broadcast({
      type: 'PLAYBACK_COMMAND',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: command,
    });
    await this.applyScheduledCommand(command, this.connection.localId);
  }

  private broadcastLocalState(state: PlaybackState): void {
    if (this.applyingRemote) return; // don't echo state we just applied from a peer
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

  private broadcastPositionProbe(state: PlaybackState): void {
    if (this.applyingRemote || !state.isPlaying) return;
    this.connection.broadcast({
      type: 'PLAYBACK_PROBE',
      senderId: this.connection.localId,
      seq: nextSeq(),
      ts: this.now(),
      payload: state,
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
    this.applyingRemote = true;
    try {
      const local = this.provider.getState();
      if (remote.trackId && remote.trackId !== local.trackId) {
        await this.provider.load(remote.trackId, false);
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

  private async applyPositionProbe(remote: PlaybackState, senderId: string): Promise<void> {
    const local = this.provider.getState();
    if (!remote.isPlaying || remote.trackId !== local.trackId) return;
    this.applyingRemote = true;
    try {
      const remotePosition = this.expectedPosition(remote, senderId);
      if (this.catchUpHold) {
        if (this.catchUpHold.senderId !== senderId || this.catchUpHold.trackId !== remote.trackId) return;
        if (remotePosition >= this.catchUpHold.resumeAtPositionSec - RESUME_POSITION_TOLERANCE_SEC) {
          this.catchUpHold = null;
          await this.provider.play();
        }
        return;
      }
      if (!local.isPlaying) return;
      const driftSec = local.positionSec - remotePosition;
      if (driftSec < HOLD_FOR_CATCH_UP_DRIFT_SEC) return;
      await this.provider.pause();
      this.catchUpHold = {
        senderId,
        trackId: remote.trackId,
        resumeAtPositionSec: this.provider.getState().positionSec,
      };
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
}
