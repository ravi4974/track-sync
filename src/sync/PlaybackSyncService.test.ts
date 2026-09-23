import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider, PlaybackState } from '../providers/MediaProvider.ts';
import type { PeerLink } from './PeerLink.ts';
import type { PeerMessage } from './protocol.ts';
import { PlaybackSyncService } from './PlaybackSyncService.ts';

class FakeProvider implements MediaProvider {
  state: PlaybackState = { trackId: null, isPlaying: false, positionSec: 0, updatedAt: Date.now() };
  private listeners: Array<(state: PlaybackState) => void> = [];
  private positionSampleListeners: Array<(state: PlaybackState) => void> = [];

  async load(trackId: string): Promise<void> {
    this.state = { ...this.state, trackId, positionSec: 0, updatedAt: Date.now() };
    this.emit();
  }

  async play(): Promise<void> {
    this.state = { ...this.state, isPlaying: true, updatedAt: Date.now() };
    this.emit();
  }

  async pause(): Promise<void> {
    this.state = { ...this.state, isPlaying: false, updatedAt: Date.now() };
    this.emit();
  }

  async seek(seconds: number): Promise<void> {
    this.state = { ...this.state, positionSec: seconds, updatedAt: Date.now() };
    this.emit();
  }

  getState(): PlaybackState {
    return this.state;
  }

  onStateChange(cb: (state: PlaybackState) => void): void {
    this.listeners.push(cb);
  }

  onPositionSample(cb: (state: PlaybackState) => void): void {
    this.positionSampleListeners.push(cb);
  }

  // Simulates a provider re-firing a state change event without any meaningful change (e.g. a heartbeat tick).
  reemitUnchanged(): void {
    this.state = { ...this.state, updatedAt: Date.now() };
    this.emit();
  }

  emitPositionSample(): void {
    for (const listener of this.positionSampleListeners) listener(this.state);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

class FakePeerLink implements PeerLink {
  readonly localId = 'LOCAL1';
  readonly sent: PeerMessage[] = [];
  private messageListeners: Array<(message: PeerMessage) => void> = [];

  broadcast(message: PeerMessage): void {
    this.sent.push(message);
  }

  onMessage(cb: (message: PeerMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onStatusChange(): void {
    // not needed for these tests
  }

  simulateIncoming(message: PeerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PlaybackSyncService', () => {
  it('broadcasts local playback state changes', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    await provider.play();

    expect(link.sent).toHaveLength(1);
    expect(link.sent[0]).toMatchObject({ type: 'PLAYBACK_STATE' });
  });

  it('broadcasts and applies a scheduled command for a local play action', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    const service = new PlaybackSyncService(provider, link);

    await service.play();

    expect(provider.getState().isPlaying).toBe(true);
    expect(link.sent).toHaveLength(1);
    expect(link.sent[0]).toMatchObject({
      type: 'PLAYBACK_COMMAND',
      payload: { revision: 1, state: { isPlaying: true } },
    });
  });

  it('broadcasts and applies a scheduled command for a local seek', async () => {
    const provider = new FakeProvider();
    provider.state = { trackId: 'abc12345678', isPlaying: false, positionSec: 5, updatedAt: Date.now() };
    const link = new FakePeerLink();
    const service = new PlaybackSyncService(provider, link);

    await service.seek(42);

    expect(provider.getState().positionSec).toBe(42);
    expect(link.sent[0]).toMatchObject({
      type: 'PLAYBACK_COMMAND',
      payload: { state: { trackId: 'abc12345678', positionSec: 42 } },
    });
  });

  it('applies a scheduled command without echoing it', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const timestamp = Date.now();

    link.simulateIncoming({
      type: 'PLAYBACK_COMMAND',
      senderId: 'REMOTE',
      seq: 1,
      ts: timestamp,
      payload: {
        revision: 1,
        executeAt: timestamp,
        state: { trackId: 'abc12345678', isPlaying: true, positionSec: 10, updatedAt: timestamp },
      },
    });
    await flush();

    expect(link.sent).toHaveLength(0);
    expect(provider.getState()).toMatchObject({ trackId: 'abc12345678', isPlaying: true });
  });

  it('does not echo state changes applied from an incoming remote message', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: { trackId: 'abc12345678', isPlaying: true, positionSec: 10, updatedAt: Date.now() },
    });
    await flush();

    expect(link.sent).toHaveLength(0);
    expect(provider.getState().trackId).toBe('abc12345678');
    expect(provider.getState().isPlaying).toBe(true);
  });

  it('loads the remote track and seeks when drift exceeds the tolerance', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const load = vi.spyOn(provider, 'load');

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: { trackId: 'newtrack1234', isPlaying: false, positionSec: 42, updatedAt: Date.now() },
    });
    await flush();

    expect(load).toHaveBeenCalledWith('newtrack1234', false);
    expect(provider.getState().trackId).toBe('newtrack1234');
    expect(provider.getState().positionSec).toBe(42);
    expect(provider.getState().isPlaying).toBe(false);
  });

  it('retries position correction when the first seek undershoots', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const originalSeek = provider.seek.bind(provider);
    let seekCount = 0;
    provider.seek = async (seconds: number) => {
      seekCount += 1;
      await originalSeek(seekCount === 1 ? seconds - 1 : seconds);
    };

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: { trackId: null, isPlaying: false, positionSec: 42, updatedAt: Date.now() },
    });
    await flush();

    expect(seekCount).toBe(2);
    expect(provider.getState().positionSec).toBe(42);
  });

  it('corrects any nonzero position difference', async () => {
    const provider = new FakeProvider();
    provider.state.positionSec = 41.9;
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const seek = vi.spyOn(provider, 'seek');

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: { trackId: null, isPlaying: false, positionSec: 42, updatedAt: Date.now() },
    });
    await flush();

    expect(seek).toHaveBeenCalledWith(42);
    expect(provider.getState().positionSec).toBe(42);
  });

  it('pauses the leading player and resumes when the remote position catches up', async () => {
    const timestamp = Date.now();
    const provider = new FakeProvider();
    provider.state = { trackId: 'abc12345678', isPlaying: true, positionSec: 10.3, updatedAt: timestamp };
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const pause = vi.spyOn(provider, 'pause');
    const play = vi.spyOn(provider, 'play');

    link.simulateIncoming({
      type: 'PLAYBACK_PROBE',
      senderId: 'REMOTE',
      seq: 1,
      ts: timestamp,
      payload: { trackId: 'abc12345678', isPlaying: true, positionSec: 10, updatedAt: timestamp },
    });
    await flush();

    expect(pause).toHaveBeenCalledOnce();
    expect(provider.getState().isPlaying).toBe(false);

    link.simulateIncoming({
      type: 'PLAYBACK_PROBE',
      senderId: 'REMOTE',
      seq: 2,
      ts: timestamp,
      payload: { trackId: 'abc12345678', isPlaying: true, positionSec: 10.3, updatedAt: timestamp },
    });
    await flush();

    expect(play).toHaveBeenCalledOnce();
    expect(provider.getState().isPlaying).toBe(true);
  });

  it('broadcasts periodic position samples as probes', () => {
    const provider = new FakeProvider();
    provider.state = { ...provider.state, isPlaying: true };
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    provider.emitPositionSample();

    expect(link.sent).toHaveLength(1);
    expect(link.sent[0]).toMatchObject({ type: 'PLAYBACK_PROBE' });
  });

  it('re-syncs position after play() to compensate for buffering/loading delay', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);

    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    const originalPlay = provider.play.bind(provider);
    provider.play = async () => {
      clock += 2000; // simulate buffering delay before playback actually starts
      await originalPlay();
    };

    const remoteUpdatedAt = clock;
    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: clock,
      payload: { trackId: null, isPlaying: true, positionSec: 10, updatedAt: remoteUpdatedAt },
    });
    await flush();

    // Without the post-play resync this would have stayed near 10s; it should account for the 2s buffering gap.
    expect(provider.getState().positionSec).toBeGreaterThanOrEqual(11.9);

    vi.restoreAllMocks();
  });

  it('ignores an out-of-order playback state from the same peer', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);
    const timestamp = Date.now();

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 2,
      ts: timestamp,
      payload: { trackId: 'newtrack1234', isPlaying: false, positionSec: 20, updatedAt: timestamp },
    });
    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: timestamp,
      payload: { trackId: 'oldtrack1234', isPlaying: false, positionSec: 5, updatedAt: timestamp },
    });
    await flush();

    expect(provider.getState()).toMatchObject({ trackId: 'newtrack1234', positionSec: 20 });
  });

  it('includes title when broadcasting local playback state', async () => {
    const provider = new FakeProvider();
    provider.state.title = 'My Video Title';
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    await provider.play();

    expect(link.sent).toHaveLength(1);
    expect(link.sent[0]).toMatchObject({
      type: 'PLAYBACK_STATE',
      payload: { title: 'My Video Title', isPlaying: true },
    });
  });

  it('applies remote title when loading a new track', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    // When FakeProvider loads a track, we simulate it extracting/receiving a title
    const originalLoad = provider.load.bind(provider);
    provider.load = async (trackId: string) => {
      await originalLoad(trackId);
      provider.state.title = 'Remote Video Title';
    };

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: {
        trackId: 'abc12345678',
        title: 'Remote Video Title',
        isPlaying: true,
        positionSec: 10,
        updatedAt: Date.now(),
      },
    });
    await flush();

    expect(provider.getState().title).toBe('Remote Video Title');
  });

  it('preserves title in local state during sync', async () => {
    const provider = new FakeProvider();
    provider.state.title = 'Local Title';
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    link.simulateIncoming({
      type: 'PLAYBACK_STATE',
      senderId: 'REMOTE',
      seq: 1,
      ts: Date.now(),
      payload: { trackId: 'abc12345678', isPlaying: true, positionSec: 10, updatedAt: Date.now() },
    });
    await flush();

    expect(provider.getState().title).toBe('Local Title');
  });

  it('does not re-broadcast when the provider re-fires a no-op state change', async () => {
    const provider = new FakeProvider();
    const link = new FakePeerLink();
    new PlaybackSyncService(provider, link);

    await provider.play();
    expect(link.sent).toHaveLength(1);

    provider.reemitUnchanged();

    expect(link.sent).toHaveLength(1);
  });
});
