import type { PeerMessage } from './protocol.ts';
import type { ConnectionStatus } from './PeerConnectionManager.ts';

// Narrow surface PlaybackSyncService/LibrarySyncService depend on, so tests can supply fakes.
export interface PeerLink {
  readonly localId: string;
  broadcast(message: PeerMessage): void;
  onMessage(cb: (message: PeerMessage) => void): void;
  onStatusChange(cb: (status: ConnectionStatus) => void): void;
}
