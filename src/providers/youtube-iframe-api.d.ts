// Minimal ambient types for the parts of the YouTube IFrame Player API this app uses.
export {};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }

  interface YouTubeNamespace {
    Player: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer;
    PlayerState: {
      UNSTARTED: number;
      ENDED: number;
      PLAYING: number;
      PAUSED: number;
      BUFFERING: number;
      CUED: number;
    };
  }

  interface YouTubePlayerOptions {
    height?: string;
    width?: string;
    videoId?: string;
    playerVars?: Record<string, number | string>;
    events?: {
      onReady?: (event: { target: YouTubePlayer }) => void;
      onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
    };
  }

  interface YouTubePlayer {
    loadVideoById(videoId: string): void;
    cueVideoById(videoId: string): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    getVideoData(): { video_id: string; title?: string };
    getVideoUrl(): string;
  }
}
