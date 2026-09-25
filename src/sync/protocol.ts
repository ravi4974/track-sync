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
  currentId: string | null;
  updatedAt: number;
}

// Continuous leader-only broadcast: a (position, timestamp) anchor plus a projected future anchor,
// so peers can predict the leader's position without the leader ever pausing to wait for them.
export interface PlaybackStreamPayload {
  trackId: string | null;
  isPlaying: boolean;
  currentPositionSec: number;
  currentTs: number;
  futurePositionSec: number;
  futureTs: number;
}

export interface LeaderTransferResponsePayload {
  requesterId: string;
  approved: boolean;
}

export interface LeaderChangedPayload {
  leaderId: string;
}

export type PeerMessage = MessageEnvelope &
  (
    | { type: 'PLAYBACK_STATE'; payload: PlaybackState }
    | { type: 'PLAYBACK_COMMAND'; payload: PlaybackCommand }
    | { type: 'PLAYBACK_STREAM'; payload: PlaybackStreamPayload }
    | { type: 'LIBRARY_SYNC_REQUEST' }
    | { type: 'LIBRARY_SNAPSHOT'; payload: LibraryItem[] }
    | { type: 'LIBRARY_DELTA'; payload: LibraryItem }
    | { type: 'QUEUE_SYNC_REQUEST' }
    | { type: 'QUEUE_SNAPSHOT'; payload: QueueSnapshot }
    | { type: 'CLOCK_PING'; payload: { originTs: number } }
    | { type: 'CLOCK_PONG'; payload: { originTs: number; remoteTs: number } }
    | { type: 'LEADER_TRANSFER_REQUEST' }
    | { type: 'LEADER_TRANSFER_RESPONSE'; payload: LeaderTransferResponsePayload }
    | { type: 'LEADER_CHANGED'; payload: LeaderChangedPayload }
  );

let seqCounter = 0;

export function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}
