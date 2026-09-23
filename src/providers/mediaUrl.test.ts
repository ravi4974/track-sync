import { describe, expect, it } from 'vitest';
import { isSpotifyUri, parseMediaUrl } from './mediaUrl.ts';

describe('parseMediaUrl', () => {
  it('normalizes Spotify resource URLs to stable URIs', () => {
    expect(parseMediaUrl('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc')).toBe(
      'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    );
    expect(parseMediaUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(
      'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    );
  });

  it('accepts YouTube video IDs and URLs', () => {
    expect(parseMediaUrl('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects unsupported Spotify URLs', () => {
    expect(parseMediaUrl('https://open.spotify.com/artist/123')).toBeNull();
    expect(isSpotifyUri('spotify:track:4iV5W9uYEdYUVa79Axb7Rh')).toBe(true);
    expect(isSpotifyUri('spotify:artist:123')).toBe(false);
  });
});