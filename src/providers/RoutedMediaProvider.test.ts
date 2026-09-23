import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider, PlaybackState } from './MediaProvider.ts';
import { RoutedMediaProvider } from './RoutedMediaProvider.ts';

function createProvider(): MediaProvider & { load: ReturnType<typeof vi.fn> } {
  const state: PlaybackState = { trackId: null, isPlaying: false, positionSec: 0, updatedAt: 0 };
  return {
    load: vi.fn(async (trackId: string) => { state.trackId = trackId; }),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    seek: vi.fn(async () => {}),
    getState: () => state,
    onStateChange: vi.fn(),
    onPositionSample: vi.fn(),
  };
}

describe('RoutedMediaProvider', () => {
  it('routes Spotify URIs to the Spotify provider and reports the selected player', async () => {
    const youtube = createProvider();
    const spotify = createProvider();
    const selected = vi.fn();
    const provider = new RoutedMediaProvider(youtube, spotify, selected);

    await provider.load('spotify:track:4iV5W9uYEdYUVa79Axb7Rh', false);

    expect(spotify.load).toHaveBeenCalledWith('spotify:track:4iV5W9uYEdYUVa79Axb7Rh', false);
    expect(youtube.load).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith('spotify');
  });
});