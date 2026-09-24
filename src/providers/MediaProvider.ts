// Generic playback contract so future providers (Spotify, local files, ...) can plug into the same sync layer.

export interface PlaybackState {
  trackId: string | null;
  title?: string;
  isPlaying: boolean;
  positionSec: number;
  updatedAt: number;
}

export interface MediaProvider {
  load(trackId: string, autoplay?: boolean): Promise<void>;
  waitUntilReady?(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  getState(): PlaybackState;
  onStateChange(cb: (state: PlaybackState) => void): void;
  onPositionSample(cb: (state: PlaybackState) => void): void;
}
