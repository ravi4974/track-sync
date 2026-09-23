import type { MediaProvider, PlaybackState } from './MediaProvider.ts';

const IFRAME_API_SRC = 'https://open.spotify.com/embed/iframe-api/v1';

interface SpotifyTrack {
  uri?: string;
  name?: string;
}

interface SpotifyPlaybackUpdate {
  data: {
    isPaused: boolean;
    position: number;
    track?: SpotifyTrack;
  };
}

interface SpotifyEmbedController {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  seek(position: number): void;
  addListener(event: 'playback_update', callback: (event: SpotifyPlaybackUpdate) => void): void;
}

interface SpotifyIframeApi {
  createController(
    element: HTMLElement,
    options: { uri: string; width?: string; height?: string },
    callback: (controller: SpotifyEmbedController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

let apiReadyPromise: Promise<SpotifyIframeApi> | null = null;

function loadSpotifyIframeApi(): Promise<SpotifyIframeApi> {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    const previousCallback = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (api) => {
      previousCallback?.(api);
      resolve(api);
    };
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = IFRAME_API_SRC;
      document.head.appendChild(script);
    }
  });
  return apiReadyPromise;
}

export class SpotifyProvider implements MediaProvider {
  private controller: SpotifyEmbedController | null = null;
  private state: PlaybackState = { trackId: null, isPlaying: false, positionSec: 0, updatedAt: Date.now() };
  private listeners: Array<(state: PlaybackState) => void> = [];
  private positionSampleListeners: Array<(state: PlaybackState) => void> = [];
  private readonly ready: Promise<void>;

  constructor(elementId: string) {
    this.ready = this.init(elementId);
  }

  private async init(elementId: string): Promise<void> {
    const api = await loadSpotifyIframeApi();
    await new Promise<void>((resolve) => {
      api.createController(
        document.getElementById(elementId)!,
        { uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', width: '100%', height: '100%' },
        (controller) => {
          this.controller = controller;
          controller.addListener('playback_update', (event) => this.updateFromSpotify(event));
          resolve();
        },
      );
    });
  }

  private updateFromSpotify(event: SpotifyPlaybackUpdate): void {
    const previous = this.state;
    const data = event.data;
    this.state = {
      trackId: data.track?.uri ?? previous.trackId,
      title: data.track?.name ?? previous.title,
      isPlaying: !data.isPaused,
      positionSec: data.position / 1000,
      updatedAt: Date.now(),
    };
    for (const listener of this.listeners) listener(this.state);
    if (this.state.isPlaying) {
      for (const listener of this.positionSampleListeners) listener(this.state);
    }
  }

  async load(trackId: string, autoplay = true): Promise<void> {
    await this.ready;
    this.controller!.loadUri(trackId);
    this.state = { trackId, isPlaying: false, positionSec: 0, updatedAt: Date.now() };
    if (autoplay) this.controller!.play();
  }

  async play(): Promise<void> {
    await this.ready;
    this.controller!.resume();
  }

  async pause(): Promise<void> {
    await this.ready;
    this.controller!.pause();
  }

  async seek(seconds: number): Promise<void> {
    await this.ready;
    this.controller!.seek(Math.max(0, seconds * 1000));
  }

  getState(): PlaybackState {
    return this.state;
  }

  getVideoTitle(): string | null {
    return this.state.title ?? null;
  }

  onStateChange(cb: (state: PlaybackState) => void): void {
    this.listeners.push(cb);
  }

  onPositionSample(cb: (state: PlaybackState) => void): void {
    this.positionSampleListeners.push(cb);
  }
}