import type { PlaybackState } from '../providers/MediaProvider.ts';
import type { LibraryItem } from '../storage/LibraryStore.ts';

interface MessageEnvelope {
  senderId: string;
  seq: number;
  ts: number;
}

export interface PlaybackCommand {
  revision: number;
  executeAt: number;
  state: PlaybackState;
}

export type PeerMessage = MessageEnvelope &
  (
    | { type: 'PLAYBACK_STATE'; payload: PlaybackState }
    | { type: 'PLAYBACK_COMMAND'; payload: PlaybackCommand }
    | { type: 'PLAYBACK_PROBE'; payload: PlaybackState }
    | { type: 'LIBRARY_SYNC_REQUEST' }
    | { type: 'LIBRARY_SNAPSHOT'; payload: LibraryItem[] }
    | { type: 'LIBRARY_DELTA'; payload: LibraryItem }
    | { type: 'CLOCK_PING'; payload: { originTs: number } }
    | { type: 'CLOCK_PONG'; payload: { originTs: number; remoteTs: number } }
  );

let seqCounter = 0;

export function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}
