import type { PlaybackState } from '../providers/MediaProvider.ts';
import type { QueueItem } from '../queue/PlaybackQueue.ts';
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

export interface QueueSnapshot {
  items: QueueItem[];
  updatedAt: number;
}

export type PeerMessage = MessageEnvelope &
  (
    | { type: 'PLAYBACK_STATE'; payload: PlaybackState }
    | { type: 'PLAYBACK_COMMAND'; payload: PlaybackCommand }
    | { type: 'PLAYBACK_PROBE'; payload: PlaybackState }
    | { type: 'LIBRARY_SYNC_REQUEST' }
    | { type: 'LIBRARY_SNAPSHOT'; payload: LibraryItem[] }
    | { type: 'LIBRARY_DELTA'; payload: LibraryItem }
    | { type: 'QUEUE_SYNC_REQUEST' }
    | { type: 'QUEUE_SNAPSHOT'; payload: QueueSnapshot }
    | { type: 'CLOCK_PING'; payload: { originTs: number } }
    | { type: 'CLOCK_PONG'; payload: { originTs: number; remoteTs: number } }
  );

let seqCounter = 0;

export function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}
