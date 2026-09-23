import type { MediaProvider, PlaybackState } from './MediaProvider.ts';
import './youtube-iframe-api.d.ts';

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
const DRIFT_THRESHOLD_SEC = 0.5;
const HEARTBEAT_MS = 250;
const DRIFT_CHECK_MS = 1000;
const SEEK_SETTLE_TIMEOUT_MS = 1000;
const SEEK_POLL_INTERVAL_MS = 50;
const PLAYER_SEEK_TOLERANCE_SEC = 0.25;
const PLAYER_STATE_TIMEOUT_MS = 10_000;
// Below this, a position change is just normal playback progress/rounding, not something worth re-broadcasting.
const NOOP_POSITION_EPSILON_SEC = 0.5;

let apiReadyPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = IFRAME_API_SRC;
      document.head.appendChild(script);
    }
  });
  return apiReadyPromise;
}

export class YouTubeProvider implements MediaProvider {
  private player: YouTubePlayer | null = null;
  private state: PlaybackState = { trackId: null, isPlaying: false, positionSec: 0, updatedAt: Date.now() };
  private listeners: Array<(state: PlaybackState) => void> = [];
  private positionSampleListeners: Array<(state: PlaybackState) => void> = [];
  private heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  private stateWaiters = new Map<number, Set<() => void>>();
  private readonly ready: Promise<void>;
  private readonly elementId: string;
  private currentTitle: string | null = null;

  constructor(elementId: string) {
    this.elementId = elementId;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await loadYouTubeIframeApi();
    await new Promise<void>((resolve) => {
      this.player = new window.YT!.Player(this.elementId, {
        height: '360',
        width: '640',
        // Native controls are hidden in favor of the app's own play/pause button.
        playerVars: { playsinline: 1, controls: 0 },
        events: {
          onReady: () => resolve(),
          onStateChange: (event) => this.handlePlayerStateChange(event.data),
        },
      });
    });
    setInterval(() => this.checkDrift(), DRIFT_CHECK_MS);
  }

  private handlePlayerStateChange(data: number): void {
    const PlayerState = window.YT!.PlayerState;
    if (data === PlayerState.PLAYING) {
      this.startHeartbeat();
      this.updateState({ isPlaying: true });
    } else if (data === PlayerState.PAUSED || data === PlayerState.ENDED) {
      this.stopHeartbeat();
      this.updateState({ isPlaying: false });
    }
    for (const resolve of [...(this.stateWaiters.get(data) ?? [])]) resolve();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatHandle = setInterval(() => this.updateState({}, true), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  // Detects seeks made via the player's own scrubber, which fire no dedicated event.
  private checkDrift(): void {
    if (!this.player || !this.state.isPlaying) return;
    const elapsedSec = (Date.now() - this.state.updatedAt) / 1000;
    const predicted = this.state.positionSec + elapsedSec;
    const actual = this.player.getCurrentTime();
    if (Math.abs(actual - predicted) > DRIFT_THRESHOLD_SEC) {
      this.updateState({});
    }
  }

  private updateState(partial: Partial<PlaybackState>, emitPositionSample = false): void {
    if (!this.player) return;
    const previous = this.state;
    const next: PlaybackState = {
      trackId: this.player.getVideoData()?.video_id ?? previous.trackId,
      title: this.currentTitle ?? previous.title,
      isPlaying: previous.isPlaying,
      positionSec: this.player.getCurrentTime(),
      updatedAt: Date.now(),
      ...partial,
    };
    this.state = next;
    // The YT iframe API can re-fire the same player state repeatedly; skip notifying on those no-ops.
    if (this.hasMeaningfulChange(previous, next)) {
      for (const listener of this.listeners) listener(next);
    }
    if (emitPositionSample && next.isPlaying) {
      for (const listener of this.positionSampleListeners) listener(next);
    }
  }

  private hasMeaningfulChange(previous: PlaybackState, next: PlaybackState): boolean {
    if (previous.trackId !== next.trackId || previous.isPlaying !== next.isPlaying) return true;
    const elapsedMSec = previous.isPlaying ? (next.updatedAt - previous.updatedAt): 0;
    const predicted = (previous.positionSec * 1000 + elapsedMSec) / 1000;
    return Math.abs(next.positionSec - predicted) > NOOP_POSITION_EPSILON_SEC;
  }

  async load(trackId: string, autoplay = true): Promise<void> {
    await this.ready;
    if (autoplay) this.player!.loadVideoById(trackId);
    else this.player!.cueVideoById(trackId);
    this.currentTitle = null;
    // Attempt to extract title after a short delay to allow video metadata to load
    setTimeout(() => {
      this.currentTitle = this.extractVideoTitle();
    }, 500);
    this.updateState({ trackId, positionSec: 0 });
  }

  private extractVideoTitle(): string | null {
    if (!this.player) return null;
    
    // Try to get title from the iframe's document
    try {
      const iframe = document.querySelector<HTMLIFrameElement>(`iframe[src*="youtube.com/embed"]`);
      if (iframe?.title) {
        // Clean up the title by removing the " - YouTube" suffix if present
        return iframe.title.replace(/ - YouTube$/, '');
      }
    } catch {
      // Ignore errors when accessing iframe
    }

    // Extract title from the page title (format: "Video Title - YouTube")
    const pageTitle = document.title;
    if (pageTitle && pageTitle !== 'YouTube') {
      return pageTitle.replace(/ - YouTube$/, '');
    }

    return null;
  }

  getVideoTitle(): string | null {
    return this.currentTitle;
  }

  async play(): Promise<void> {
    await this.ready;
    const playing = this.waitForPlayerState(window.YT!.PlayerState.PLAYING);
    this.player!.playVideo();
    await playing;
  }

  async pause(): Promise<void> {
    await this.ready;
    const paused = this.waitForPlayerState(window.YT!.PlayerState.PAUSED);
    this.player!.pauseVideo();
    await paused;
  }

  private waitForPlayerState(targetState: number): Promise<void> {
    if (this.player!.getPlayerState() === targetState) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        waiters.delete(finish);
        resolve();
      };
      const waiters = this.stateWaiters.get(targetState) ?? new Set<() => void>();
      const timeout = setTimeout(finish, PLAYER_STATE_TIMEOUT_MS);
      waiters.add(finish);
      this.stateWaiters.set(targetState, waiters);
    });
  }

  async seek(seconds: number): Promise<void> {
    await this.ready;
    const duration = this.player!.getDuration();
    const boundedSeconds = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
    this.player!.seekTo(boundedSeconds, true);
    await this.waitForSeek(boundedSeconds);
    this.updateState({});
  }

  private async waitForSeek(targetSeconds: number): Promise<void> {
    const deadline = Date.now() + SEEK_SETTLE_TIMEOUT_MS;
    while (Math.abs(this.player!.getCurrentTime() - targetSeconds) > PLAYER_SEEK_TOLERANCE_SEC) {
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, SEEK_POLL_INTERVAL_MS));
    }
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
}
