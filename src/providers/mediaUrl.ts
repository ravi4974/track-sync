export function parseMediaUrl(input: string): string | null {
  if (/^[\w-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (host === 'open.spotify.com' || host.endsWith('.spotify.com')) {
      const [type, id] = url.pathname.split('/').filter(Boolean);
      if (['track', 'album', 'playlist', 'episode', 'show'].includes(type) && /^[\w-]+$/.test(id ?? '')) {
        return `spotify:${type}:${id}`;
      }
      return null;
    }
    return url.searchParams.get('v') ?? url.pathname.split('/').pop() ?? null;
  } catch {
    return null;
  }
}

export function isSpotifyUri(trackId: string): boolean {
  return /^spotify:(track|album|playlist|episode|show):[\w-]+$/.test(trackId);
}