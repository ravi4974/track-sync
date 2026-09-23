import type { MediaProvider, PlaybackState } from './MediaProvider.ts';
import { isSpotifyUri } from './mediaUrl.ts';

export class RoutedMediaProvider implements MediaProvider {
  private activeProvider: MediaProvider;
  private listeners: Array<(state: PlaybackState) => void> = [];
  private positionSampleListeners: Array<(state: PlaybackState) => void> = [];
  private readonly youtube: MediaProvider;
  private readonly spotify: MediaProvider;
  private readonly onProviderChange?: (provider: 'youtube' | 'spotify') => void;

  constructor(
    youtube: MediaProvider,
    spotify: MediaProvider,
    onProviderChange?: (provider: 'youtube' | 'spotify') => void,
  ) {
    this.youtube = youtube;
    this.spotify = spotify;
    this.onProviderChange = onProviderChange;
    this.activeProvider = youtube;
    this.subscribe(youtube);
    this.subscribe(spotify);
  }

  private subscribe(provider: MediaProvider): void {
    provider.onStateChange((state) => {
      if (provider === this.activeProvider) {
        for (const listener of this.listeners) listener(state);
      }
    });
    provider.onPositionSample((state) => {
      if (provider === this.activeProvider) {
        for (const listener of this.positionSampleListeners) listener(state);
      }
    });
  }

  async load(trackId: string, autoplay = true): Promise<void> {
    const isSpotify = isSpotifyUri(trackId);
    this.activeProvider = isSpotify ? this.spotify : this.youtube;
    this.onProviderChange?.(isSpotify ? 'spotify' : 'youtube');
    await this.activeProvider.load(trackId, autoplay);
  }

  play(): Promise<void> {
    return this.activeProvider.play();
  }

  pause(): Promise<void> {
    return this.activeProvider.pause();
  }

  seek(seconds: number): Promise<void> {
    return this.activeProvider.seek(seconds);
  }

  getState(): PlaybackState {
    return this.activeProvider.getState();
  }

  getVideoTitle(): string | null {
    const provider = this.activeProvider as MediaProvider & { getVideoTitle?: () => string | null };
    return provider.getVideoTitle?.() ?? null;
  }

  onStateChange(cb: (state: PlaybackState) => void): void {
    this.listeners.push(cb);
  }

  onPositionSample(cb: (state: PlaybackState) => void): void {
    this.positionSampleListeners.push(cb);
  }
}